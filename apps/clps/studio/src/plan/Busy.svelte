<script lang="ts">
  // A calculation in progress: a small spinner and what is being calculated. The spinner holds still for people
  // who ask for reduced motion. Screen readers hear progress from the one status line in the landing section.
  let { text, class: className = '', style = '' }: { text: string; class?: string; style?: string } = $props();
</script>

<span class="inline-flex items-center gap-1.5 text-xs text-muted {className}" {style}>
  <span
    aria-hidden="true"
    class="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-rule border-t-sun motion-reduce:animate-none"
  ></span>
  <span>{text}</span>
</span>
