import { projectCategoryOptions, SITE_PROJECT_CATEGORIES } from '../lib/siteCategories'
import { Select } from './ui'

export function ProjectCategorySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Select required aria-label="Categoria" value={value} onChange={event => onChange(event.target.value)}>
    <option value="" disabled>Seleziona una categoria</option>
    {projectCategoryOptions(value).map(category => <option key={category} value={category}>{category}{!SITE_PROJECT_CATEGORIES.includes(category) ? ' (categoria precedente)' : ''}</option>)}
  </Select>
}
