import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import { authRouteGuard } from "./auth.guard";
import AppLayout from "../layouts/AppLayout.vue";

declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/app/overview" },
  {
    path: "/login",
    name: "login",
    component: () => import("../views/LoginView.vue"),
    meta: { guestOnly: true },
  },
  {
    path: "/register",
    name: "register",
    component: () => import("../views/RegisterView.vue"),
    meta: { guestOnly: true },
  },
  {
    path: "/app",
    component: AppLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: "overview",
        name: "dashboard",
        component: () => import("../views/HomeView.vue"),
      },
      {
        path: "progression/settings",
        name: "progression-settings",
        component: () => import("../views/ProgressionSettingsView.vue"),
      },
      {
        path: "progression/settings/new",
        name: "progression-settings-new",
        component: () => import("../views/ProgressionSettingEditorView.vue"),
      },
      {
        path: "progression/settings/:id",
        name: "progression-setting-edit",
        component: () => import("../views/ProgressionSettingEditorView.vue"),
      },
      {
        path: "progression/automation",
        name: "automation-consents",
        component: () => import("../views/AutomationConsentsView.vue"),
      },
      {
        path: "progression/automation/new",
        name: "automation-new",
        component: () => import("../views/NewAutomationConsentView.vue"),
      },
      {
        path: "progression/automation/:id",
        name: "automation-detail",
        component: () => import("../views/AutomationConsentDetailView.vue"),
      },
      {
        path: "progression",
        name: "progression",
        component: () => import("../views/ProgressionView.vue"),
      },
      {
        path: "progression/new",
        name: "progression-new",
        component: () => import("../views/NewProgressionView.vue"),
      },
      {
        path: "progression/recommendations/:id",
        name: "progression-detail",
        component: () => import("../views/ProgressionDetailView.vue"),
      },
      {
        path: "routine/:planId/weeks/:weekId/days/:dayId",
        name: "routine-day",
        component: () => import("../views/RoutineDayView.vue"),
      },
      {
        path: "history",
        name: "workout-history",
        component: () => import("../views/WorkoutSessionsView.vue"),
        props: { historyOnly: true },
      },
      {
        path: "",
        name: "home",
        component: () => import("../views/RoutineView.vue"),
      },
      {
        path: "profile",
        name: "profile",
        component: () => import("../views/ProfileView.vue"),
      },
      {
        path: "measurements",
        name: "measurements",
        component: () => import("../views/MeasurementsView.vue"),
      },
      {
        path: "workouts",
        name: "workout-sessions",
        component: () => import("../views/WorkoutSessionsView.vue"),
      },
      {
        path: "workouts/:sessionId",
        name: "workout-session-detail",
        component: () => import("../views/WorkoutSessionDetailView.vue"),
      },
      {
        path: "training-plans",
        name: "training-plans",
        component: () => import("../views/TrainingPlansView.vue"),
      },
      {
        path: "training-plans/:planId",
        name: "training-plan-detail",
        component: () => import("../views/TrainingPlanDetailView.vue"),
      },
      {
        path: "exercises",
        name: "exercise-catalog",
        component: () => import("../views/ExercisesView.vue"),
      },
      {
        path: "exercises/:exerciseId",
        name: "exercise-detail",
        component: () => import("../views/ExerciseDetailView.vue"),
      },
    ],
  },
  { path: "/:pathMatch(.*)*", redirect: "/app" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(authRouteGuard);
