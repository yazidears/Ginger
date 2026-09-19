import type { NextConfig } from 'next';
const config:NextConfig={distDir:process.env.GINGER_DIST_DIR||'.next',devIndicators:false, poweredByHeader:false,async headers(){return[{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'SAMEORIGIN'}]}];}};
export default config;
