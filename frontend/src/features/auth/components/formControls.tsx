import React from 'react'

export const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="form-error">{message}</p> : null

export const inputClass = 'form-input'

export const buttonClass = 'btn-primary'
