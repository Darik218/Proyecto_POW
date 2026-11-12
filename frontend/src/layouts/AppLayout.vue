<script setup lang="ts">
import AuthenticatedLayout from "../components/AuthenticatedLayout.vue";
</script>
<template>
  <AuthenticatedLayout
    ><main id="main-content" class="app-main" tabindex="-1">
      <RouterView v-slot="{ Component }"
        ><Transition name="route" mode="out-in"
          ><component :is="Component" /></Transition
      ></RouterView></main
  ></AuthenticatedLayout>
</template>
