<script setup lang="ts">
import PulsoIcon from "./PulsoIcon.vue";
defineProps<{ title: string; description?: string; icon?: string }>();
</script>
<template>
  <header class="page-heading ui-page-header">
    <div class="ui-page-header__copy">
      <h1><PulsoIcon v-if="icon" :name="icon" :size="30" />{{ title }}</h1>
      <p v-if="description" class="intro">{{ description }}</p>
      <slot />
    </div>
    <div v-if="$slots.actions" class="ui-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>
