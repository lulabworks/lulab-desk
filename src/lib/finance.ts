import type { ExpenseCategory, PaymentKind } from './types'

export type JobExpenseDraft = {
  category: ExpenseCategory
  description: string
  amount: number
  incurred_on: string
  supplier: string
  notes: string
}

export type JobPaymentDraft = {
  kind: PaymentKind
  amount: number
  paid_on: string
  method: string
  notes: string
}

export function buildJobExpenseInsert(jobId: string, expense: JobExpenseDraft) {
  return {
    job_id: jobId,
    category: expense.category,
    description: expense.description.trim(),
    amount: Number(expense.amount),
    incurred_on: expense.incurred_on,
    supplier: expense.supplier.trim() || null,
    notes: expense.notes.trim() || null
  }
}

export function buildJobPaymentInsert(jobId: string, payment: JobPaymentDraft) {
  return {
    job_id: jobId,
    kind: payment.kind,
    amount: Number(payment.amount),
    paid_on: payment.paid_on,
    method: payment.method.trim() || null,
    notes: payment.notes.trim() || null
  }
}
