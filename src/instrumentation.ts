export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NODE_ENV!=='test'&&process.env.GINGER_EXTERNAL_WORKER!=='1'){
  const {startReceptivityRefresh}=await import('./lib/receptivity/engine');
  startReceptivityRefresh();
 }
}
