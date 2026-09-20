import type { NextConfig } from 'next';
// Next 16.3's MCP file logger retains failed writes indefinitely (e.g. a full disk).
// Keep normal terminal/browser logging; disable only the optional dev MCP log buffer.
const config:NextConfig={distDir:process.env.GINGER_DIST_DIR||'.next',devIndicators:false,experimental:{mcpServer:false,webpackMemoryOptimizations:true},onDemandEntries:{maxInactiveAge:25000,pagesBufferLength:2}, poweredByHeader:false,async headers(){return[{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'SAMEORIGIN'}]}];}};
// Low-disk verification avoids retaining a second webpack pack cache.
if(process.env.GINGER_LOW_DISK_BUILD==='1'){
 config.webpack=(webpackConfig)=>{webpackConfig.cache=false;return webpackConfig;};
 config.experimental={...config.experimental,cpus:1};
}
export default config;
