<script setup lang="ts">
import AuthenticatedLayout from '../components/AuthenticatedLayout.vue'
</script>

<template>
  <AuthenticatedLayout>
    <main class="app-main">
      <RouterView />
    </main>
  </AuthenticatedLayout>
</template>
