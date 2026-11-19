<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ status: string; label?: string }>();
const tone = computed(() => {
  if (
    [
      "COMPLETED",
      "APPLIED",
      "ACTIVE",
      "VALID",
      "INCREASE",
      "SATISFIED",
      "APPROVED",
      "ELIGIBLE",
    ].includes(props.status)
  )
    return "success";
  if (
    [
      "REVOKED",
      "CANCELLED",
      "REJECTED",
      "BLOCKED",
      "INVALID",
      "INSUFFICIENT_DATA",
      "EXPIRED",
    ].includes(props.status)
  )
    return "danger";
  if (
    [
      "PENDING",
      "PENDING_CONFIRMATION",
      "REVIEW_REQUIRED",
      "CONFIGURATION_REQUIRED",
      "IN_PROGRESS",
      "CONFIGURATION_CHANGED",
      "NOT_EVALUABLE",
    ].includes(props.status)
  )
    return "warning";
  return "neutral";
});
</script>
<template>
  <span class="ui-badge" :class="`ui-badge--${tone}`"
    ><span class="ui-badge__dot" aria-hidden="true"></span
    ><span class="ui-badge__text">{{ label ?? status }}</span></span
  >
</template>
