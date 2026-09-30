// GitHub Pages serves precompressed .gz files as ordinary binary assets.
// Decode that lossless transport format explicitly; original GLBs remain the
// fallback for older browsers and independently downloadable CAD deliverables.
export async function loadModel(loader,url){
 const source=new URL(url);
 if(typeof DecompressionStream==='function'){
  const compressed=new URL(source);compressed.pathname+='.gz';
  try{
   const response=await fetch(compressed);
   if(response.ok&&response.body){
    const bytes=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return await loader.parseAsync(bytes,new URL('.',source).href);
   }
  }catch(error){console.warn('Compressed model unavailable; loading original GLB.',source.pathname,error.message);}
 }
 return loader.loadAsync(source.href);
}
