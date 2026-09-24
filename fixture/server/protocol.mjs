/** Small public body schema; editor JSON/HTML never crosses this boundary. */
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const fail=(status,message)=>Object.assign(Error(message),{status});
export function validateBody(body,cap=16384) {
  if(!Array.isArray(body)||!body.length||body.length>256) throw fail(400,'Comment body required');
  const out=body.map(b=>{
    if(b?.kind==='text'&&typeof b.value==='string') return {kind:'text',value:b.value};
    if(b?.kind==='choice'&&typeof b.value==='string') return {kind:'choice',value:b.value,...(typeof b.name==='string'?{name:b.name}:{}),...(typeof b.label==='string'?{label:b.label}:{})};
    if(b?.kind!=='rich'||b.version!==1||!Array.isArray(b.content)||b.content.length>4096) throw fail(400,'Unsupported comment body');
    return {kind:'rich',version:1,content:b.content.map(s=>{
      if(s?.kind==='text'&&typeof s.text==='string') return {kind:'text',text:s.text};
      if(s?.kind==='newline') return {kind:'newline'};
      if(s?.kind==='mention'&&typeof s.label==='string'&&s.label.trim()&&s.label.length<=256&&
        ((s.entity==='bot'&&s.id==='current')||(s.entity==='user'&&UUID.test(s.id)))) {
        return {kind:'mention',entity:s.entity,id:s.id,label:s.label};
      }
      throw fail(400,'Invalid comment segment');
    })};
  });
  if(Buffer.byteLength(JSON.stringify(out))>cap) throw fail(413,`Comment exceeds ${cap} bytes`);
  if(!bodyText(out).trim()) throw fail(400,'Comment body required');
  return out;
}
export function bodyText(body) {
  return (body??[]).map(b=>b.kind==='rich'?b.content.map(s=>s.kind==='newline'?'\n':s.kind==='mention'?'@'+s.label:s.text).join(''):b.kind==='choice'?(b.label??b.value):b.value).join(' · ');
}
export function recipients(body) {
  const all=(body??[]).flatMap(b=>b.kind==='rich'?b.content.filter(s=>s.kind==='mention'):[]);
  return [...new Map(all.map(s=>[`${s.entity}:${s.id}`,s])).values()];
}
/** Encode literal text, not canonical tags. Renderer decodes once AFTER tag scan.
 * Encode '&' first so pasted entity strings remain literal (no double decode).
 * Numeric punctuation avoids Markdown transformations while preserving glyphs.
 */
export const literal=s=>String(s??'').replace(/[&<>`*_[\]{}\\!#|~+.=-]/g,c=>`&#${c.charCodeAt(0)};`);
export const sendingFailed=name=>`Sending failed, ping ${name} in chat to retry.`;
export function receipt({body,recipients:people,invokesBot,url,title,appTitle}) {
  const forRow=[...people.filter(p=>p.entity==='user').map(p=>`<user_mention id="${p.id}" />`),...(invokesBot?['<agent_mention />']:[])].join(' ');
  const quote=bodyText(body).replace(/\r\n?/g,'\n').split('\n').map(line=>'> '+literal(line)).join('\n');
  return `Comment posted in [${literal(title)} · ${literal(appTitle)}](<${url}>)\n\nFor: ${forRow}\n\n${quote}`;
}
export function discussionUrl(base,discussion,event) {
  const url=new URL(base);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password) throw fail(500,'Invalid app URL');
  url.searchParams.set('anno_discussion',discussion);
  url.searchParams.set('anno_event',event);
  return url.toString();
}
