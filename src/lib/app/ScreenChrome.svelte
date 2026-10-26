<script>
 import { screenHost, screenSize } from './screen-slots.js';
 let { title = 'Maia City', nativeWindow = false } = $props();
</script>

<header class="screen-chrome" class:native-window={nativeWindow} use:screenSize aria-label="Screen controls">
 <div class="screen-leading">
  <div class="screen-diagnostics" use:screenHost={'diagnostics'}></div>
  <div class="screen-titles">
   <div class="screen-title-slot" use:screenHost={'title'}></div>
   <span class="screen-title-fallback">{title}</span>
  </div>
 </div>
 <div class="screen-center" use:screenHost={'center'}></div>
 <div class="screen-right" use:screenHost={'right'}></div>
 <div class="screen-stats" use:screenHost={'stats'}></div>
</header>
