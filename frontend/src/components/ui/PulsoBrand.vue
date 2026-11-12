<script setup lang="ts">
defineProps<{ compact?: boolean }>();
</script>
<template>
  <span class="pulso-brand"
    ><svg
      viewBox="0 0 48 40"
      width="44"
      height="38"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 22h9l5-10 7 22L31 5l5 20 4-7h6"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      /></svg
    ><span class="pulso-brand__word"
      >PULSO<span class="pulso-brand__period">.</span
      ><small v-if="!compact">Tu progreso, medido.</small></span
    ></span
  >
</template>
