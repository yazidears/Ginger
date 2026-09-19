import {deepfireConfigured} from '@/lib/providers/deepfire';
export const runtime='nodejs';
export async function GET(){return Response.json({
 deepfire:deepfireConfigured(),sage:Boolean(process.env.OPENAI_API_KEY?.trim()),
 mtg:Boolean(process.env.MTG_NORMALIZED_FILE?.trim()),weatherNext:Boolean(process.env.WEATHERNEXT_NORMALIZED_FILE?.trim()),elmfire:Boolean(process.env.ELMFIRE_PERIMETERS_FILE?.trim()),
},{headers:{'Cache-Control':'no-store'}});}
