/** Lossless transport compression for static hosts without Content-Encoding. */
export async function fetchModelBuffer(config, onProgress = () => {}, baseURL = import.meta.url) {
  const started = performance.now();
  let usedCompression = typeof DecompressionStream !== 'undefined';
  let fallbackReason = null;
  async function download(url, compressed) {
    const response = await fetch(new URL(url, baseURL));
    if (!response.ok) throw new Error(`模型下载失败 (${response.status})`);
    const total = Number(response.headers.get('content-length')) || (compressed ? config.compressedBytes : config.originalBytes);
    let loaded = 0;
    const reader = response.body.getReader();
    // Inspect bytes because some hosts serve .gz as opaque data, while others
    // set Content-Encoding and the browser has already decompressed the body.
    const prefix = [];
    let prefixLength = 0;
    while (prefixLength < 2) {
      const part = await reader.read();
      if (part.done) break;
      prefix.push(part.value); prefixLength += part.value.length;
    }
    const head = new Uint8Array(prefixLength);
    let headOffset = 0;
    for (const part of prefix) { head.set(part, headOffset); headOffset += part.length; }
    const isGzip = head[0] === 0x1f && head[1] === 0x8b;
    let first = true;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const part = first ? {done: false, value: head} : await reader.read();
          first = false;
          if (part.done) { controller.close(); return; }
          loaded += part.value.length;
          onProgress({loaded, total, compressed, phase: 'download'});
          controller.enqueue(part.value);
        } catch (error) { controller.error(error); }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    const decoded = isGzip ? stream.pipeThrough(new DecompressionStream('gzip')) : stream;
    const buffer = await new Response(decoded).arrayBuffer();
    const magic = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    if (magic.length !== 4 || magic[0] !== 103 || magic[1] !== 108 || magic[2] !== 84 || magic[3] !== 70) throw new Error('模型格式校验失败');
    if (buffer.byteLength !== config.originalBytes) throw new Error('模型文件长度不完整');
    return buffer;
  }
  let buffer;
  if (usedCompression) {
    try { buffer = await download(config.compressedURL, true); }
    catch (error) { fallbackReason = error.message || String(error) || '压缩模型下载或解压失败'; usedCompression = false; }
  }
  if (!buffer) buffer = await download(config.fallbackURL, false);
  return {buffer, delivery: {
    compressed: usedCompression,
    fallbackReason,
    expectedTransferBytes: usedCompression ? config.compressedBytes : config.originalBytes,
    originalBytes: buffer.byteLength,
    downloadAndDecodeMilliseconds: Math.round(performance.now() - started),
  }};
}
