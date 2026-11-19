<script setup lang="ts">
import PulsoIcon from "./PulsoIcon.vue";
withDefaults(
  defineProps<{ title: string; description?: string; icon?: string }>(),
  { icon: "activity" },
);
</script>
<template>
  <div class="empty-state ui-empty">
    <div class="ui-empty__icon"><PulsoIcon :name="icon" :size="30" /></div>
    <strong>{{ title }}</strong>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.default" class="ui-empty__actions"><slot /></div>
  </div>
</template>
