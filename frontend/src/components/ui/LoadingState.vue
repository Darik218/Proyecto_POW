<script setup lang="ts">
withDefaults(defineProps<{ label?: string; rows?: number }>(), {
  label: "Cargando información…",
  rows: 3,
});
</script>
<template>
  <div class="ui-loading" role="status" aria-live="polite" aria-busy="true">
    <span class="ui-loading__label"
      ><span class="ui-spinner" aria-hidden="true"></span>{{ label }}</span
    >
    <div aria-hidden="true" class="ui-skeleton-list">
      <span v-for="i in rows" :key="i" class="ui-skeleton" />
    </div>
  </div>
</template>
