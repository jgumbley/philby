import { isKeyRelease, matchesKey, ProcessTerminal, truncateToWidth, TuiAltScreen, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

export async function confirmClose(kind:'frame'|'pane',name:string):Promise<boolean> {
  if(!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Close confirmation requires a terminal');
  const terminal=new ProcessTerminal();
  const dialog=new TuiAltScreen(terminal,false,undefined,{mouse:false});
  const title=kind==='frame'?`Kill frame ${name} and its panes?`:`Kill pane ${name}?`;
  let yes=false;
  const highlight=(label:string)=>`\x1b[1;7m${label}\x1b[0m`;
  dialog.addChild({
    invalidate() {},
    render(width) {
      const buttons=[yes?'[No]':highlight('[No]'),yes?highlight('[Yes]'):'[Yes]'].join('   ');
      const lines=[...wrapTextWithAnsi(title,width),'',buttons,'','←/→ select   Enter confirm   Esc cancel'];
      const padding=Math.max(0,Math.floor((terminal.rows-lines.length)/2));
      return [...Array<string>(padding).fill(''),...lines.map(line=>{
        const fitted=truncateToWidth(line,width);
        return ' '.repeat(Math.floor((width-visibleWidth(fitted))/2))+fitted;
      })];
    },
  });
  const decision=new Promise<boolean>(resolve=>{
    dialog.addInputListener(data=>{
      if(!isKeyRelease(data)) {
        if(matchesKey(data,'escape') || matchesKey(data,'ctrl+c')) resolve(false);
        else if(matchesKey(data,'enter')) resolve(yes);
        else if(matchesKey(data,'left') || data.toLowerCase()==='n') {yes=false;dialog.requestRender();}
        else if(matchesKey(data,'right') || data.toLowerCase()==='y') {yes=true;dialog.requestRender();}
      }
      return {consume:true};
    });
  });
  try {
    dialog.start();
    return await decision;
  } finally {dialog.stop();}
}
