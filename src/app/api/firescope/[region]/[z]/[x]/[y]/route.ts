import {fireScopeRegions} from '@/lib/wildfire-references';
// Fixed upstream: same-origin tiles work even when the publisher omits CORS headers.
export async function GET(_request:Request,{params}:{params:Promise<{region:string;z:string;x:string;y:string}>}) {
 const {region,z,x,y}=await params;
 if(!Object.hasOwn(fireScopeRegions,region)||![z,x,y].every(v=>/^\d{1,4}$/.test(v))||+z<2||+z>12||+x>=2**+z||+y>=2**+z) return new Response('Invalid research tile',{status:400});
 const source=fireScopeRegions[region as keyof typeof fireScopeRegions];
 try {
  const response=await fetch(`https://tiles.firescope.ai/${source.path}/${z}/${x}/${y}.webp`,{signal:AbortSignal.timeout(10000),next:{revalidate:86400},redirect:'error'});
  if(response.status===404)return new Response('No research data for this tile',{status:404,headers:{'Cache-Control':'public, max-age=3600'}});
  if(!response.ok||!response.headers.get('content-type')?.includes('image/webp'))return new Response('Research tiles unavailable',{status:502});
  return new Response(await response.arrayBuffer(),{headers:{'Content-Type':'image/webp','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('Research tiles unavailable',{status:502});}
}
