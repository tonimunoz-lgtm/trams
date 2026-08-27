#!/usr/bin/env python3
"""
sync_intervals.py — Trams. Se ejecuta desde un GitHub Action programado.

Versión adaptada del script de RunTrack para este proyecto: en vez de
guardar actividades privadas por usuario, guarda cada actividad completada
como una RUTA en la base compartida (routes/) de Trams — con
createdBy = el uid de quien la hizo, para que salga como suya en la app.

Multiusuario desde el principio: recorre a TODOS los usuarios de Trams que
tengan su propia clave de Intervals.icu conectada (guardada en
users/{uid}/integrations/garmin), y sincroniza a cada uno con su propia
cuenta — nunca mezcla los datos de una persona con los de otra.

No calculamos splits ni mejores esfuerzos aquí (eso tiene sentido en
RunTrack, una app de carreras — Trams es sobre RUTAS a seguir, no sobre
cronometrar esfuerzos), pero sí usamos el mismo truco de leer el archivo
FIT original cuando está disponible, para una distancia/desnivel más
precisos que reconstruirlo nosotros del GPS en bruto.

Variables de entorno requeridas (GitHub Secrets):
  FIREBASE_SERVICE_ACCOUNT_JSON
  TARGET_UID (opcional — si viene, solo sincroniza a esa persona)
"""

import os
import io
import gzip
import json
import math
import sys
from datetime import datetime, timedelta, timezone

import requests
import firebase_admin
from firebase_admin import credentials, firestore, auth as fb_auth

try:
    import fitparse
except ImportError:
    fitparse = None

DEFAULT_LOOKBACK_DAYS = 14
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", DEFAULT_LOOKBACK_DAYS))
MAX_STORED_POINTS = 2000
API_BASE = "https://intervals.icu/api/v1"


# --------------------------------------------------------------------------- geometría / stats
def haversine(a, b):
    R = 6371000
    dlat = math.radians(b["lat"] - a["lat"])
    dlon = math.radians(b["lon"] - a["lon"])
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def clean_points(points):
    out = []
    for p in points:
        if out:
            prev = out[-1]
            if prev["t"] and p["t"]:
                dt = (p["t"] - prev["t"]).total_seconds()
                if dt <= 0:
                    continue
                d = haversine(prev, p)
                if d / dt > 40:
                    continue
        out.append(p)
    return out


def cumulative_distances(points):
    if points and all(p.get("nativeDist") is not None for p in points):
        base = points[0]["nativeDist"]
        cum, prev = [], 0.0
        for p in points:
            val = max(prev, p["nativeDist"] - base)
            cum.append(val)
            prev = val
        return cum

    cum = [0.0]
    for i in range(1, len(points)):
        cum.append(cum[i - 1] + haversine(points[i - 1], points[i]))
    return cum


def compute_summary(raw_points):
    points = clean_points(raw_points)
    if len(points) < 2:
        return None
    cum = cumulative_distances(points)
    total_distance = cum[-1]
    start_t, end_t = points[0]["t"], points[-1]["t"]
    duration = (end_t - start_t).total_seconds() if start_t and end_t else None

    elevs = [p["ele"] for p in points if p["ele"] is not None]
    elev_gain, elev_loss = 0.0, 0.0
    if len(elevs) > 4:
        smoothed = []
        for i in range(len(points)):
            win = [p["ele"] for p in points[max(0, i - 2): i + 3] if p["ele"] is not None]
            smoothed.append(sum(win) / len(win) if win else None)
        for i in range(1, len(smoothed)):
            if smoothed[i] is not None and smoothed[i - 1] is not None:
                diff = smoothed[i] - smoothed[i - 1]
                if diff > 0.15:
                    elev_gain += diff
                elif diff < -0.15:
                    elev_loss += -diff

    return {
        "points": points, "cum": cum, "totalDistance": total_distance,
        "duration": duration, "elevGain": elev_gain, "elevLoss": elev_loss,
        "startTime": start_t,
    }


def perp_distance(p, a, b):
    def to_xy(pt):
        return (
            pt["lon"] * 111320 * math.cos(a["lat"] * math.pi / 180),
            pt["lat"] * 110540,
        )
    px, py = to_xy(p)
    ax, ay = to_xy(a)
    bx, by = to_xy(b)
    dx, dy = bx - ax, by - ay
    len2 = dx * dx + dy * dy
    if len2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len2))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def simplify_douglas_peucker(points, tolerance=6):
    n = len(points)
    if n <= 2:
        return points
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        max_d, idx = 0.0, None
        for i in range(start + 1, end):
            d = perp_distance(points[i], points[start], points[end])
            if d > max_d:
                max_d, idx = d, i
        if idx is not None and max_d > tolerance:
            keep[idx] = True
            stack.append((start, idx))
            stack.append((idx, end))
    return [p for p, k in zip(points, keep) if k]


def downsample(points, max_points=MAX_STORED_POINTS):
    pts = simplify_douglas_peucker(points, tolerance=6)
    if len(pts) > max_points:
        step = len(pts) / max_points
        out = [pts[int(i * step)] for i in range(max_points)]
        out.append(pts[-1])
        pts = out
    return pts


# --------------------------------------------------------------------------- Intervals.icu API
def icu_get(path, api_key, params=None):
    resp = requests.get(f"{API_BASE}{path}", auth=("API_KEY", api_key), params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_recent_activities(athlete_id, api_key, days=LOOKBACK_DAYS):
    oldest = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    newest = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return icu_get(f"/athlete/{athlete_id}/activities", api_key, params={"oldest": oldest, "newest": newest})


def fetch_original_file(activity_id, api_key):
    resp = requests.get(f"{API_BASE}/activity/{activity_id}/file", auth=("API_KEY", api_key), timeout=30)
    resp.raise_for_status()
    raw = resp.content
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass
    return raw


def semicircles_to_degrees(value):
    return value * (180.0 / 2**31) if value is not None else None


def parse_fit_native(raw_bytes):
    """Igual que en RunTrack: puntos GPS + resumen directamente del FIT
    original del reloj — más preciso que reconstruirlo del GPS en bruto."""
    if fitparse is None:
        return None, None
    try:
        fitfile = fitparse.FitFile(io.BytesIO(raw_bytes))
        fitfile.parse()
    except Exception:
        return None, None

    points = []
    for msg in fitfile.get_messages("record"):
        vals = {f.name: f.value for f in msg}
        lat = semicircles_to_degrees(vals.get("position_lat"))
        lon = semicircles_to_degrees(vals.get("position_long"))
        if lat is None or lon is None:
            continue
        ele = vals.get("enhanced_altitude")
        if ele is None:
            ele = vals.get("altitude")
        points.append({
            "lat": lat, "lon": lon, "ele": ele, "t": vals.get("timestamp"),
            "nativeDist": vals.get("distance"),
        })

    if len(points) < 2:
        return None, None

    native_summary = None
    for msg in fitfile.get_messages("session"):
        vals = {f.name: f.value for f in msg}
        dist, timer = vals.get("total_distance"), vals.get("total_timer_time")
        if dist and timer:
            ascent, descent = vals.get("total_ascent"), vals.get("total_descent")
            native_summary = {
                "totalDistance": dist,
                "duration": vals.get("total_elapsed_time") or timer,
                "elevGain": ascent,
                "elevLoss": descent,
            }
        break

    return points, native_summary


def native_summary_looks_valid(native_summary, computed_distance_m):
    if not native_summary or not computed_distance_m:
        return False
    dist = native_summary.get("totalDistance")
    if not dist:
        return False
    ratio = dist / computed_distance_m
    return 0.85 <= ratio <= 1.15


def streams_to_points(streams, start_date):
    by_type = {s.get("type"): s for s in streams if isinstance(s, dict)}
    time_stream = by_type.get("time") or {}
    latlng_stream = by_type.get("latlng") or {}
    altitude_stream = by_type.get("altitude") or {}

    time_s = time_stream.get("data") or []
    lat_arr = latlng_stream.get("data") or []
    lon_arr = latlng_stream.get("data2") or []
    altitude_arr = altitude_stream.get("data") or []

    n = min(len(lat_arr), len(lon_arr))
    points = []
    for i in range(n):
        lat, lon = lat_arr[i], lon_arr[i]
        if lat is None or lon is None:
            continue
        t = start_date + timedelta(seconds=time_s[i]) if i < len(time_s) and time_s[i] is not None else None
        points.append({
            "lat": lat, "lon": lon,
            "ele": altitude_arr[i] if i < len(altitude_arr) else None,
            "t": t,
        })
    return points


def parse_start_date(activity):
    raw = activity.get("start_date") or activity.get("start_date_local")
    if not raw:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def suggest_name(activity, summary):
    if activity.get("name"):
        return activity["name"]
    km = summary["totalDistance"] / 1000
    return f"Ruta de {km:.1f} km"


ACTIVITY_TYPE_MAP = {
    "Run": "running", "VirtualRun": "running", "TrailRun": "running",
    "Ride": "cycling", "VirtualRide": "cycling",
    "MountainBikeRide": "mtb", "GravelRide": "mtb",
    "Hike": "hiking", "Walk": "hiking",
}


# --------------------------------------------------------------------------- por usuario
def sync_one_user(db, uid, api_key, athlete_id):
    routes_ref = db.collection("routes")

    existing_ids = set()
    for doc in routes_ref.where("createdBy", "==", uid).select(["intervalsActivityId"]).stream():
        aid = doc.to_dict().get("intervalsActivityId")
        if aid:
            existing_ids.add(str(aid))

    print("  Consultando actividades recientes en Intervals.icu…")
    try:
        activities = fetch_recent_activities(athlete_id, api_key)
    except Exception as e:
        print(f"  ERROR consultando Intervals.icu: {e}")
        return 0
    print(f"  {len(activities)} actividad(es) encontradas en los últimos {LOOKBACK_DAYS} días.")

    user_name = "Alguien"
    try:
        user_name = fb_auth.get_user(uid).display_name or "Alguien"
    except Exception:
        pass

    imported = 0
    for act in activities:
        aid = str(act.get("id"))
        if aid in existing_ids:
            continue

        activity_type = ACTIVITY_TYPE_MAP.get(act.get("type", ""))
        if not activity_type:
            continue  # tipo no relevante para una app de rutas (ej. Swim, WeightTraining...)

        print(f"  Nueva actividad encontrada: {aid} ({act.get('name')})")

        native_points, native_summary = None, None
        try:
            raw_file = fetch_original_file(aid, api_key)
            native_points, native_summary = parse_fit_native(raw_file)
        except Exception as e:
            print(f"    No se pudo leer el FIT original ({e}), se usará streams.json")

        if native_points:
            raw_points = native_points
        else:
            try:
                streams = icu_get(f"/activity/{aid}/streams.json", api_key,
                                   params={"types": "time,latlng,altitude"})
            except Exception as e:
                print(f"    No se pudieron descargar los streams de {aid}: {e}")
                continue
            raw_points = streams_to_points(streams, parse_start_date(act))

        summary = compute_summary(raw_points)
        if not summary:
            print("    Sin puntos GPS válidos, se omite.")
            continue

        if native_summary_looks_valid(native_summary, summary["totalDistance"]):
            summary["totalDistance"] = native_summary["totalDistance"]
            summary["duration"] = native_summary["duration"] or summary["duration"]
            if native_summary.get("elevGain") is not None:
                summary["elevGain"] = native_summary["elevGain"]
            if native_summary.get("elevLoss") is not None:
                summary["elevLoss"] = native_summary["elevLoss"]

        stored_points = downsample(summary["points"])

        route_doc = {
            "name": suggest_name(act, summary),
            "activityType": activity_type,
            "description": "",
            "distance": summary["totalDistance"],
            "elevGain": summary["elevGain"],
            "elevLoss": summary["elevLoss"],
            "duration": summary["duration"],
            "source": "garmin-auto",
            "intervalsActivityId": aid,
            "createdBy": uid,
            "createdByName": user_name,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "points": [
                {
                    "lat": round(p["lat"], 6), "lon": round(p["lon"], 6),
                    "ele": round(p["ele"]) if p["ele"] is not None else None,
                }
                for p in stored_points
            ],
        }

        doc_ref = routes_ref.document()
        route_doc["id"] = doc_ref.id
        doc_ref.set(route_doc)
        imported += 1
        print(f"    Guardada como ruta {doc_ref.id}")

    return imported


def main():
    sa_json = os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"]
    target_uid = os.environ.get("TARGET_UID") or None

    cred = credentials.Certificate(json.loads(sa_json))
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    users_to_sync = []

    if target_uid:
        doc = db.collection("users").document(target_uid).collection("integrations").document("garmin").get()
        if doc.exists and doc.to_dict().get("intervalsApiKey"):
            users_to_sync.append((target_uid, doc.to_dict()))
        else:
            print(f"El usuario {target_uid} no tiene Garmin conectado.")
            return
    else:
        query = db.collection_group("integrations").where("source", "==", "garmin")
        for doc in query.stream():
            uid = doc.reference.parent.parent.id
            data = doc.to_dict()
            if data.get("intervalsApiKey"):
                users_to_sync.append((uid, data))

    print(f"Sincronizando {len(users_to_sync)} usuario(s) con Garmin conectado.")

    total = 0
    for uid, integration in users_to_sync:
        print(f"\n=== Usuario {uid} ===")
        try:
            total += sync_one_user(db, uid, integration["intervalsApiKey"], integration.get("intervalsAthleteId", "0"))
        except Exception as e:
            print(f"  ERROR sincronizando a este usuario: {e}")
            continue

    print(f"\nListo. {total} ruta(s) nueva(s) importada(s) en total.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
