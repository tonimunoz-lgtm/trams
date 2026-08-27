// parsers.js — lee archivos GPX y FIT y los convierte en una lista de
// puntos {lat, lon, ele, t}. A diferencia de RunTrack, aquí "t" (el
// tiempo) es opcional en todo momento: muchas rutas de senderismo/Wikiloc
// son solo un trazado a seguir, sin cronómetro.

const Parsers = (() => {

  function parseGPX(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

    // Preferimos <trkpt> (track, lo normal en una grabación real); si no
    // hay, recurrimos a <rtept> (route, un trazado planificado sin grabar).
    let nodes = [...doc.getElementsByTagName('trkpt')];
    if (!nodes.length) nodes = [...doc.getElementsByTagName('rtept')];

    const points = nodes.map(node => {
      const lat = parseFloat(node.getAttribute('lat'));
      const lon = parseFloat(node.getAttribute('lon'));
      const eleNode = node.getElementsByTagName('ele')[0];
      const timeNode = node.getElementsByTagName('time')[0];
      return {
        lat, lon,
        ele: eleNode ? parseFloat(eleNode.textContent) : null,
        t: timeNode ? new Date(timeNode.textContent) : null
      };
    }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));

    const nameNode = doc.getElementsByTagName('name')[0];
    const name = nameNode ? nameNode.textContent.trim() : null;

    return { points, name };
  }

  function parseFIT(arrayBuffer) {
    // TODO: pendiente de verificar qué versión de fit-file-parser sigue
    // funcionando bien desde un <script> de navegador (la última versión
    // parece haber dejado de ofrecer una build para navegador, solo
    // ESM/CJS para empaquetadores) — hasta confirmarlo con seguridad,
    // preferimos avisar claramente en vez de arriesgarnos a un fallo
    // silencioso. GPX ya cubre el caso principal de Wikiloc.
    return Promise.reject(new Error('Los archivos .fit todavía no están soportados en Trams — sube el .gpx de la misma ruta mientras tanto.'));
  }

  async function parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'gpx') {
      const text = await file.text();
      const { points, name } = parseGPX(text);
      return { points, name, source: 'gpx' };
    }

    if (ext === 'fit') {
      // Ver nota en parseFIT: pendiente de una versión de la librería
      // verificada para navegador. De momento lanza un aviso claro.
      return parseFIT();
    }

    throw new Error('Formato no soportado. Sube un archivo .gpx (por ahora, .fit está en camino).');
  }

  return { parseGPX, parseFIT, parseFile };
})();
