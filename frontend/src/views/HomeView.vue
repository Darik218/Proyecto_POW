<template>
  <section class="page-view">
    <div class="page-heading">
      <p class="eyebrow">ESPACIO PERSONAL</p>
      <h1>Tu progreso, medido.</h1>
      <p class="intro">Consulta tu perfil y conserva un historial de tus medidas corporales.</p>
    </div>

    <div class="dashboard-grid">
      <RouterLink class="dashboard-card" :to="{ name: 'profile' }">
        <span class="dashboard-card__icon" aria-hidden="true">01</span>
        <span class="dashboard-card__body">
          <strong>Mi perfil</strong>
          <small>Fecha de nacimiento y unidad de medida preferida.</small>
        </span>
        <span class="dashboard-card__arrow" aria-hidden="true">→</span>
      </RouterLink>

      <RouterLink class="dashboard-card" :to="{ name: 'measurements' }">
        <span class="dashboard-card__icon" aria-hidden="true">02</span>
        <span class="dashboard-card__body">
          <strong>Medidas corporales</strong>
          <small>Registra tu peso y consulta las mediciones anteriores.</small>
        </span>
        <span class="dashboard-card__arrow" aria-hidden="true">→</span>
      </RouterLink>
    </div>
  </section>
</template>
