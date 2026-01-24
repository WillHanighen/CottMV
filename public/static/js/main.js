var c={container:null,init(){if(this.container)return;this.container=document.createElement("div"),this.container.id="toast-container",this.container.className="fixed top-4 right-4 z-50 flex flex-col gap-2",document.body.appendChild(this.container)},show(e,t="info",s=4000){this.init();let n="toast-"+Date.now(),r={success:'<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',error:'<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',warning:'<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',info:'<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'},i={success:"bg-green-600 border-green-500",error:"bg-red-600 border-red-500",warning:"bg-yellow-600 border-yellow-500",info:"bg-blue-600 border-blue-500"},o=document.createElement("div");if(o.id=n,o.className=`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-white ${i[t]}`,o.style.animation="slideIn 0.3s ease-out",o.innerHTML=`
      ${r[t]}
      <p class="text-sm flex-1">${e}</p>
      <button class="p-1 hover:bg-white/20 rounded transition-colors" onclick="window.ToastManager.dismiss('${n}')">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `,this.container.appendChild(o),s>0)setTimeout(()=>this.dismiss(n),s);return n},dismiss(e){let t=document.getElementById(e);if(t)t.style.animation="slideOut 0.2s ease-in forwards",setTimeout(()=>t.remove(),200)},success(e,t){return this.show(e,"success",t)},error(e,t){return this.show(e,"error",t)},warning(e,t){return this.show(e,"warning",t)},info(e,t){return this.show(e,"info",t)}},f={overlay:null,resolvePromise:null,init(){if(this.overlay)return;this.overlay=document.createElement("div"),this.overlay.id="confirm-modal-overlay",this.overlay.className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center opacity-0 invisible transition-all duration-200",this.overlay.innerHTML=`
      <div class="bg-card border rounded-lg p-6 max-w-md w-full mx-4 transform scale-95 transition-transform duration-200" id="confirm-modal">
        <div id="confirm-modal-icon" class="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"></div>
        <h3 id="confirm-modal-title" class="text-lg font-semibold text-center mb-2"></h3>
        <p id="confirm-modal-message" class="text-muted-foreground text-center text-sm mb-6"></p>
        <div class="flex gap-3 justify-center">
          <button id="confirm-modal-cancel" class="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">Cancel</button>
          <button id="confirm-modal-confirm" class="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">Confirm</button>
        </div>
      </div>
    `,document.body.appendChild(this.overlay),document.getElementById("confirm-modal-cancel")?.addEventListener("click",()=>this.close(!1)),document.getElementById("confirm-modal-confirm")?.addEventListener("click",()=>this.close(!0)),this.overlay.addEventListener("click",(e)=>{if(e.target===this.overlay)this.close(!1)}),document.addEventListener("keydown",(e)=>{if(e.key==="Escape"&&this.overlay?.classList.contains("opacity-100"))this.close(!1)})},show(e={}){this.init();let{title:t="Confirm Action",message:s="Are you sure you want to proceed?",confirmText:n="Confirm",cancelText:r="Cancel",type:i="warning"}=e,o={warning:'<svg class="h-6 w-6 text-yellow-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',danger:'<svg class="h-6 w-6 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',info:'<svg class="h-6 w-6 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'},y={warning:"bg-yellow-500/20",danger:"bg-red-500/20",info:"bg-blue-500/20"},l=document.getElementById("confirm-modal-icon");if(l)l.className=`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${y[i]}`,l.innerHTML=o[i];document.getElementById("confirm-modal-title").textContent=t,document.getElementById("confirm-modal-message").textContent=s;let a=document.getElementById("confirm-modal-confirm");a.textContent=n,a.className=`px-4 py-2 rounded-lg transition-colors ${i==="danger"?"bg-red-600 text-white hover:bg-red-700":"bg-primary text-primary-foreground hover:bg-primary/90"}`,document.getElementById("confirm-modal-cancel").textContent=r,this.overlay.classList.remove("opacity-0","invisible"),this.overlay.classList.add("opacity-100","visible");let d=document.getElementById("confirm-modal");return d?.classList.remove("scale-95"),d?.classList.add("scale-100"),document.body.style.overflow="hidden",a.focus(),new Promise((g)=>{this.resolvePromise=g})},close(e){this.overlay.classList.remove("opacity-100","visible"),this.overlay.classList.add("opacity-0","invisible");let t=document.getElementById("confirm-modal");if(t?.classList.remove("scale-100"),t?.classList.add("scale-95"),document.body.style.overflow="",this.resolvePromise)this.resolvePromise(e),this.resolvePromise=null}},m=document.createElement("style");m.textContent=`
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;document.head.appendChild(m);window.ToastManager=c;window.ConfirmModal=f;if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{c.init()});else c.init();
