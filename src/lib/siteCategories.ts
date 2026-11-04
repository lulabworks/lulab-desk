import { JOB_TYPES, type JobType } from './types'

// Public projects keep human-readable strings for compatibility with existing content.
export const SITE_PROJECT_CATEGORIES = JOB_TYPES.map(item => item.label)
export function projectCategoryFromJob(type: JobType) {
  return JOB_TYPES.find(item => item.value === type)?.label ?? ''
}
export function projectCategoryOptions(current: string) {
  return current && !SITE_PROJECT_CATEGORIES.includes(current)
    ? [...SITE_PROJECT_CATEGORIES, current]
    : SITE_PROJECT_CATEGORIES
}
