export function mountNavigationHelp(container, keyboard, {campus=false}={}) {
  const help=document.createElement('details');
  help.className='camera-help'+(campus?' campus-camera-help':'');
  help.innerHTML=`<summary>操作说明 / 镜头移动</summary><div class="camera-help-body">
    <p>按住按钮连续移动，也可使用键盘。</p>
    <div class="camera-pad" role="group" aria-label="镜头水平移动">
      <button data-camera-move="forward" class="move-forward" aria-label="镜头前进">↑ 前进</button>
      <button data-camera-move="left" class="move-left" aria-label="镜头左移">← 左移</button>
      <button data-camera-move="backward" class="move-back" aria-label="镜头后退">↓ 后退</button>
      <button data-camera-move="right" class="move-right" aria-label="镜头右移">右移 →</button>
    </div><div class="camera-height" role="group" aria-label="镜头高度">
      <button data-camera-move="up" aria-label="镜头上升">上升 E / PgUp</button>
      <button data-camera-move="down" aria-label="镜头下降">下降 Q / PgDn</button>
    </div>
    <p><kbd>↑ ↓</kbd> 前进 / 后退，<kbd>← →</kbd> 左右横移<br><kbd>E Q</kbd> 上升 / 下降，<kbd>Shift</kbd> 加速</p>
    <p>拖动旋转 · 滚轮缩放 · 右键拖动平移${campus?'':'<br>点击模型选中物件；设备显示控制，构件显示资料。'}</p>
    <p class="camera-focus-note">鼠标选完下拉项即可移动镜头。用键盘编辑选项时，按 Enter 或 Esc 返回镜头；输入框与滑杆保留自身按键。</p>
  </div>`;
  container.append(help);
  const unbind=keyboard.bindButtons(help);
  help.addEventListener('toggle',()=>{if(!help.open)keyboard.release();});
  return {element:help,dispose(){unbind();help.remove();}};
}
