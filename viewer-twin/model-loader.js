// Hosts may serve .gz as opaque bytes or let the browser decode Content-Encoding.
// Inspect the body before decoding; original GLBs remain the compatibility fallback.
export async function loadModel(loader,url){
 const source=new URL(url);
 if(typeof DecompressionStream==='function'){
  const compressed=new URL(source);compressed.pathname+='.gz';
  try{
   const response=await fetch(compressed);
   if(response.ok&&response.body){
    let bytes=await response.arrayBuffer();
    const head=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
    if(head[0]===0x1f&&head[1]===0x8b){
     bytes=await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    return await loader.parseAsync(bytes,new URL('.',source).href);
   }
  }catch(error){console.warn('Compressed model unavailable; loading original GLB.',source.pathname,error.message);}
 }
 return loader.loadAsync(source.href);
}
