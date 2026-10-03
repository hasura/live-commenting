import {createHash} from 'node:crypto';
import {fail} from './protocol.mjs';

const invalid=message=>{throw fail(400,message);};
const finite=Number.isFinite;
const region=r=>r&&[r.xPct,r.yPct,r.wPct,r.hPct].every(finite)&&r.xPct>=0&&r.yPct>=0&&r.wPct>0&&r.hPct>0&&r.xPct+r.wPct<=1.000001&&r.yPct+r.hPct<=1.000001;
function jsonValue(v,depth=0){
 if(depth>12)return false;
 if(v===null||typeof v==='boolean'||typeof v==='string')return true;
 if(typeof v==='number')return finite(v);
 if(Array.isArray(v))return v.every(x=>jsonValue(x,depth+1));
 return v&&typeof v==='object'&&Object.values(v).every(x=>jsonValue(x,depth+1));
}
function png(bytes){
 if(bytes.length>2_000_000)throw fail(413,'Selection image exceeds 2 MB');
 if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')invalid('Invalid selection PNG');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>1200||height>1200)invalid('Invalid selection image dimensions');
 let data=false,ended=false;
 for(let offset=8;offset<bytes.length;){
  if(offset+12>bytes.length)invalid('Invalid PNG chunk');
  const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
  if(offset+length+12>bytes.length)invalid('Invalid PNG chunk');
  if(type==='IDAT')data=true;
  offset+=length+12;
  if(type==='IEND'){if(length!==0||offset!==bytes.length)invalid('Invalid PNG end');ended=true;break;}
 }
 if(!data||!ended)invalid('Incomplete selection PNG');
 return {width,height};
}
/** Returns normalized references and pending immutable blobs. Caller commits both
 * in the same SQLite transaction. Image bytes never enter the event JSON. */
export function prepareRefs(refs,lookupSnapshot){
 if(!Array.isArray(refs)||!refs.length||refs.length>50)invalid('Opening comment needs a reference');
 const images=[];
 const normalized=refs.map(r=>{
  if(typeof r?.id!=='string'||!r.id||!['anno_id','text','region','chart'].includes(r.kind))invalid('Invalid reference');
  if(r.kind==='text'&&(!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<=r.start||typeof r.quote!=='string'))invalid('Invalid text offsets');
  if(r.kind==='region'&&!region(r))invalid('Invalid region');
  if(r.label!=null&&typeof r.label!=='string')invalid('Invalid reference label');
  if(r.kind==='chart'){
   if(Object.keys(r).some(k=>!['kind','version','id','label','semantic','selection','members','region','snapshot'].includes(k)))invalid('Unknown chart reference field');
   if(r.version!==1||!['point','rectangle'].includes(r.selection)||!region(r.region))invalid('Invalid chart selection');
   if(r.members!==null&&(!Array.isArray(r.members)||r.members.length>50000))invalid('Invalid chart membership');
   if(r.selection==='point'&&r.members?.length!==1)invalid('Point selection needs one member');
   const keys=new Set();
   for(const m of r.members??[]){
    if(Object.keys(m??{}).some(k=>!['key','label','kind','values'].includes(k)))invalid('Unknown chart member field');
    if(typeof m?.key!=='string'||!m.key||m.key.length>512||keys.has(m.key)||typeof m.label!=='string'||!m.label||m.label.length>1000)invalid('Invalid chart member identity');
    keys.add(m.key);
    if(m.kind!=null&&typeof m.kind!=='string')invalid('Invalid chart member kind');
    if(m.values!=null&&(typeof m.values!=='object'||Array.isArray(m.values)||!jsonValue(m.values)))invalid('Invalid chart member values');
    if('geometry'in m||'el'in m||'path'in m)invalid('Chart geometry is not persisted');
   }
   if(r.selection==='rectangle'&&!r.snapshot)invalid('Chart rectangle needs an image snapshot');
  }
  if(!r.snapshot)return r;
  const s=r.snapshot;
  if(typeof s.capturedAt!=='string'||!Number.isFinite(Date.parse(s.capturedAt)))invalid('Invalid capture time');
  let id,width,height;
  if(s.dataUrl!=null){
   if(typeof s.dataUrl!=='string'||s.dataUrl.length>2_800_000)throw fail(413,'Selection image is too large');
   const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(s.dataUrl);
   if(!match)invalid('Selection image must be a PNG');
   const bytes=Buffer.from(match[1],'base64');
   if(bytes.toString('base64')!==match[1])invalid('Invalid image encoding');
   ({width,height}=png(bytes));
   id=createHash('sha256').update(bytes).digest('hex');
   images.push({id,width,height,bytes});
  }else{
   if(typeof s.id!=='string'||!(/^[a-f0-9]{64}$/).test(s.id))invalid('Invalid snapshot id');
   const stored=lookupSnapshot(s.id);if(!stored)invalid('Unknown snapshot');
   ({id,width,height}=stored);
  }
  if(s.width!==width||s.height!==height)invalid('Snapshot dimensions do not match PNG');
  return {...r,snapshot:{id,width,height,capturedAt:s.capturedAt}};
 });
 if(Buffer.byteLength(JSON.stringify(normalized))>6_000_000)throw fail(413,'Selection metadata is too large');
 return {refs:normalized,images};
}
