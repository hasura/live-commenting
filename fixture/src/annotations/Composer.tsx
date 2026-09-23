import { useEffect, useId, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension, type JSONContent } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import Mention from '@tiptap/extension-mention';
import { UndoRedo } from '@tiptap/extensions';
import { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion';
import { ArrowUp, CornerDownLeft, Keyboard } from 'lucide-react';
import { Hint, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import type { Body, MentionOption, RichSegment, SubmitOptions } from './types';
import { useDeviceBehavior } from './device';
import { useMentions } from './mentions';
import { bodyText, hasBotMention } from './store';

export interface ComposerProps {
  initial?: Body[];
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  onSubmit: (body: Body[], options?: SubmitOptions) => void | Promise<void>;
  onCancel: () => void;
}
export type ComposerComponent = React.ComponentType<ComposerProps>;

export function toEditor(body: Body[] = []): JSONContent {
  const content: JSONContent[] = [];
  for (const b of body) {
    const segments: RichSegment[] = b.kind === 'rich' ? b.content : [{kind:'text',text:bodyText([b])}];
    if (content.length) content.push({type:'text',text:' · '});
    for (const s of segments) {
      if(s.kind==='mention') content.push({type:'mention',attrs:{id:`${s.entity}:${s.id}`,label:s.label}});
      else if(s.kind==='newline') content.push({type:'hardBreak'});
      else s.text.split('\n').forEach((line,i)=>{if(i)content.push({type:'hardBreak'});if(line)content.push({type:'text',text:line});});
    }
  }
  return {type:'doc',content:[{type:'paragraph',content}]};
}
export function fromEditor(doc: JSONContent): Body[] {
  const content: RichSegment[]=[];
  const walk=(node:JSONContent)=>{
    if(node.type==='text'&&node.text) content.push({kind:'text',text:node.text});
    else if(node.type==='hardBreak')content.push({kind:'newline'});
    else if(node.type==='mention'){
      const [entity,...id]=String(node.attrs?.id).split(':');
      if(entity==='bot'||entity==='user')content.push({kind:'mention',entity,id:id.join(':'),label:String(node.attrs?.label)});
    } else node.content?.forEach(walk);
  };
  doc.content?.forEach((node,i)=>{if(i)content.push({kind:'newline'});walk(node);});
  return [{kind:'rich',version:1,content}];
}
export const matchingMentions=(entries:MentionOption[],query:string)=>entries.filter(p=>
  [p.label,...(p.entity==='bot'?['promptql']:[])].some(s=>s.toLocaleLowerCase().includes(query.toLocaleLowerCase())));

type Picker=SuggestionProps<MentionOption>;

export function TextComposer({initial,placeholder='Add a comment…',submitLabel='Comment',autoFocus=true,onSubmit,onCancel}:ComposerProps) {
  const behavior=useDeviceBehavior();
  const source=useMentions();
  const latest=useRef({behavior,source,onSubmit,onCancel});
  latest.current={behavior,source,onSubmit,onCancel};
  const [picker,setPicker]=useState<Picker|null>(null);
  const pickerRef=useRef<Picker|null>(null), selected=useRef(0);
  const [active,setActive]=useState(0), [notifyBot,setNotifyBot]=useState(false);
  // Preserve the manual choice while a semantic bot mention forces delivery.
  const [inlineBot,setInlineBot]=useState(()=>hasBotMention(initial??[]));
  const [directHintOpen,setDirectHintOpen]=useState(false);
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const busyRef=useRef(false), submitRef=useRef(()=>{});
  const [nonempty,setNonempty]=useState(!!initial?.length);
  const listId=useId();
  const update=(p:Picker|null)=>{pickerRef.current=p;selected.current=0;setActive(0);setPicker(p);};
  const choose=(index:number)=>{const p=pickerRef.current;if(p?.items[index])p.command(p.items[index]);};
  const editor=useEditor({
    immediatelyRender:true,
    extensions:[
      Document,Paragraph,Text,HardBreak,UndoRedo,
      Mention.extend({parseHTML:()=>[]}).configure({
        HTMLAttributes:{class:'ca-mention'},
        deleteTriggerWithBackspace:true,
        renderText:({node})=>`@${node.attrs.label}`,
        suggestion:{
          char:'@',allowSpaces:false,
          items:({query})=>matchingMentions(latest.current.source.directory?.entries??[],query),
          command:({editor,range,props})=>{
            const option = props as unknown as MentionOption;
            editor.chain().focus().insertContentAt(range,[{type:'mention',attrs:{id:`${option.entity}:${option.id}`,label:option.label}},{type:'text',text:' '}]).run();
          },
          render:()=>({
            onStart:p=>{latest.current.source.refresh?.();update(p);},
            onUpdate:update,
            onExit:()=>update(null),
            onKeyDown:({event})=>{
              if(event.isComposing||event.keyCode===229)return false;
              if(event.key==='Escape'||event.key==='Tab'){
                if(editor)exitSuggestion(editor.view);
                update(null);
                if(event.key==='Escape'){event.preventDefault();event.stopPropagation();return true;}
                return false;
              }
              const p=pickerRef.current;
              if((event.key==='ArrowDown'||event.key==='ArrowUp')&&p?.items.length){
                event.preventDefault();selected.current=(selected.current+(event.key==='ArrowDown'?1:-1)+p.items.length)%p.items.length;setActive(selected.current);return true;
              }
              if(event.key==='Enter'&&p){
                event.preventDefault();event.stopPropagation();
                if(p.items.length)choose(selected.current);
                return true;
              }
              return false;
            },
          }),
        },
      }),
      Extension.create({
        name:'commentKeys',priority:1000,
        addKeyboardShortcuts(){return {
          Delete:()=>{
            const selection=this.editor.state.selection;
            const next=selection.$from.nodeAfter;
            if(selection.empty&&next?.type.name==='mention')
              return this.editor.commands.deleteRange({from:selection.from,to:selection.from+next.nodeSize});
            return false;
          },
          Enter:()=>{
            if(this.editor.view.composing)return false;
            if(pickerRef.current){choose(selected.current);return true;}
            if(latest.current.behavior.enterSends){submitRef.current();return true;}
            return this.editor.commands.setHardBreak();
          },
          Escape:()=>{
            if(pickerRef.current){exitSuggestion(this.editor.view);update(null);return true;}
            if(!busyRef.current)latest.current.onCancel();
            return true;
          },
        };},
      }),
    ],
    content:toEditor(initial),
    editorProps:{
      attributes:{class:'ca-composer-input',role:'textbox','aria-multiline':'true','aria-label':placeholder,'data-placeholder':placeholder,tabindex:'0',enterkeyhint:behavior.enterKeyHint??'enter'},
      handlePaste:(view,event)=>{
        const text=event.clipboardData?.getData('text/plain');
        if(text===undefined)return false;
        event.preventDefault();
        // Always plain text: pasted HTML or mention markup cannot create a recipient.
        const lines=text.replace(/\r\n?/g,'\n').split('\n');
        const nodes=lines.flatMap((line,i)=>[...(i?[view.state.schema.nodes.hardBreak.create()]:[]),...(line?[view.state.schema.text(line)]:[])]);
        editor?.commands.insertContent(nodes.map(n=>n.toJSON()));
        return true;
      },
      handleDOMEvents:{
        keydown:(_view,e)=>{if(e.key==='Escape')e.stopPropagation();if(e.key==='Enter'&&(e.isComposing||e.keyCode===229)){e.stopPropagation();return true;}return false;},
        blur:()=>{if(editor)exitSuggestion(editor.view);return false;},
      },
    },
    onUpdate:({editor})=>{
      const body=fromEditor(editor.getJSON());
      setNonempty(!!bodyText(body).trim());
      setInlineBot(hasBotMention(body));
    },
  },[]);
  useEffect(()=>{
    if(!autoFocus||!editor)return;
    if(behavior.allowComposerFocusScroll)editor.view.dom.focus();else editor.view.dom.focus({preventScroll:true});
  },[editor,autoFocus]);
  useEffect(()=>{
    if(!editor)return;
    editor.setEditable(!busy);
  },[editor,busy]);
  useEffect(()=>{if(!inlineBot)setDirectHintOpen(false);},[inlineBot]);
  // Directory refresh while a picker is open updates results without changing text.
  useEffect(()=>{
    const p=pickerRef.current;
    if(p){const next={...p,items:matchingMentions(source.directory?.entries??[],p.query)};update(next);}
  },[source.directory]);
  useEffect(()=>{
    if(!editor)return;
    const dom=editor.view.dom;
    dom.setAttribute('aria-expanded',String(!!picker));
    dom.setAttribute('aria-autocomplete','list');
    if(picker){dom.setAttribute('aria-controls',listId);if(picker.items[active]){dom.setAttribute('aria-activedescendant',`${listId}-${active}`);document.getElementById(`${listId}-${active}`)?.scrollIntoView({block:'nearest'});}else dom.removeAttribute('aria-activedescendant');}
    else {dom.removeAttribute('aria-controls');dom.removeAttribute('aria-activedescendant');}
  },[editor,picker,active,listId]);
  const submit=async()=>{
    if(!editor||busyRef.current)return;
    const body=fromEditor(editor.getJSON());
    if(!bodyText(body).trim())return;
    busyRef.current=true;setBusy(true);setError('');
    try {await latest.current.onSubmit(body,{notifyBot:notifyBot||hasBotMention(body)});}
    catch(e){setError((e as Error).message||'Saving failed. Your draft is still here.');}
    finally{busyRef.current=false;setBusy(false);}
  };
  submitRef.current=()=>{void submit();};
  const directLabel=`Post directly to ${source.directory?.botName ?? 'the bot'}`;
  const directHint=`Remove the @mention from the comment to not post to ${source.directory?.botName ?? 'the bot'}.`;
  return <div className="ca-composer">
    <EditorContent editor={editor}/>
    {picker&&<div className="ca-mention-picker" data-anno-ignore="">
      <div id={listId} role="listbox" aria-label="Mention participants">
        {picker.items.map((p,i)=><button type="button" role="option" aria-selected={active===i} id={`${listId}-${i}`}
          tabIndex={-1} className={`ca-mention-option${active===i?' ca-selected':''}`} key={`${p.entity}:${p.id}`}
          onPointerDown={e=>e.preventDefault()} onClick={()=>choose(i)}>
          <span>{p.label}</span><span className="ca-mention-kind">{p.entity==='bot'?'Bot':'Person'}</span>
        </button>)}
        {!picker.items.length&&<div className="ca-mention-empty">{source.error?'Participants unavailable':'No matching participants'}</div>}
      </div>
    </div>}
    {source.directory&&<Tooltip open={inlineBot&&directHintOpen} onOpenChange={open=>setDirectHintOpen(inlineBot&&open)}>
      <TooltipTrigger asChild>
        <span className="ca-direct-control" tabIndex={inlineBot?0:undefined}
          role={inlineBot?'group':undefined} aria-label={inlineBot?`${directLabel}. ${directHint}`:undefined}
          onClick={e=>{if(inlineBot){e.preventDefault();setDirectHintOpen(true);}}}
          onKeyDown={e=>{if(inlineBot&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();setDirectHintOpen(true);}}}>
          <label className="ca-direct"><input type="checkbox" checked={notifyBot||inlineBot} disabled={busy||inlineBot}
            onChange={e=>setNotifyBot(e.target.checked)}/>{directLabel}</label>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{directHint}</TooltipContent>
    </Tooltip>}
    {error&&<p role="alert" className="ca-composer-error">{error}</p>}
    <div className="ca-composer-actions">
      {behavior.showEnterShortcut&&<Hint content="Enter to post · Shift+Enter for a new line"><span className="ca-hint" tabIndex={0} aria-label="Keyboard shortcuts"><Keyboard className="ca-icon"/><CornerDownLeft className="ca-icon ca-icon-sm"/> to post</span></Hint>}
      <button className="ca-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className="ca-btn" onClick={()=>void submit()} disabled={!nonempty||busy}><ArrowUp className="ca-icon"/>{busy?'Posting…':submitLabel}</button>
    </div>
  </div>;
}
