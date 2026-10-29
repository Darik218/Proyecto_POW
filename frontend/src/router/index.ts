import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { authRouteGuard } from './auth.guard'
import AuthenticatedLayout from '../components/AuthenticatedLayout.vue'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/app' },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('../views/RegisterView.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/app',
    component: AuthenticatedLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('../views/HomeView.vue'),
      },
      {
        path: 'profile',
        name: 'profile',
        component: () => import('../views/ProfileView.vue'),
      },
      {
        path: 'measurements',
        name: 'measurements',
        component: () => import('../views/MeasurementsView.vue'),
      },
      {
        path: 'exercises',
        name: 'exercise-catalog',
        component: () => import('../views/ExercisesView.vue'),
      },
      {
        path: 'exercises/:exerciseId',
        name: 'exercise-detail',
        component: () => import('../views/ExerciseDetailView.vue'),
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/app' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(authRouteGuard)
