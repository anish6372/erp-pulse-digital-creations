// Types for state.js (the app-wide session state), used by the React + TypeScript pages.
export interface Me {
  id: number;
  name: string;
  role: 'Admin' | 'Employee' | string;
  department?: string;
}
export const state: { me: Me | null; token: string | null; [key: string]: any };
