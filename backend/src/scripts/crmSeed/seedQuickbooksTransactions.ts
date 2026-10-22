import { quickbooksAuth, closeDb } from './auth'
import { makeQbClient } from './qbClient'
import { CUSTOMERS, monthlyRevenue, isoDate, MONTH_COUNT } from './data'

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function activeCustomerCount(monthIndex: number): number {
  return CUSTOMERS.filter((c) => monthlyRevenue(c, monthIndex) > 0).length
}

async function main() {
  const { accessToken, realmId } = await quickbooksAuth()
  const qb = makeQbClient(accessToken, realmId)

  console.log('Resolving reference ids (accounts, classes, items, vendors, customers)...')
  const accounts = await qb.query<{ Id: string; Name: string }>('Account')
  const classes = await qb.query<{ Id: string; Name: string }>('Class')
  const items = await qb.query<{ Id: string; Name: string }>('Item')
  const vendors = await qb.query<{ Id: string; DisplayName: string }>('Vendor')
  const customers = await qb.query<{ Id: string; DisplayName: string }>('Customer')

  const acctId = (name: string) => {
    const a = accounts.find((x) => x.Name === name)
    if (!a) throw new Error(`Account not found: ${name}`)
    return a.Id
  }
  const classId = (name: string) => {
    const c = classes.find((x) => x.Name === name)
    if (!c) throw new Error(`Class not found: ${name}`)
    return c.Id
  }
  const itemId = (name: string) => {
    const it = items.find((x) => x.Name === name)
    if (!it) throw new Error(`Item not found: ${name}`)
    return it.Id
  }
  const vendorId = (name: string) => {
    const v = vendors.find((x) => x.DisplayName === name)
    if (!v) throw new Error(`Vendor not found: ${name}`)
    return v.Id
  }
  const customerId = (name: string) => {
    const c = customers.find((x) => x.DisplayName === name)
    if (!c) throw new Error(`Customer not found: ${name}`)
    return c.Id
  }

  const CHECKING = acctId('Checking')
  const CLASS_CORE = classId('Core Platform')
  const CLASS_PS_HW = classId('Professional Services & Hardware')
  const ITEM_SUBSCRIPTION = itemId('DriverInsights Platform Subscription')
  const ITEM_PS = itemId('Onboarding & Professional Services')
  const ITEM_HW = itemId('GPS Hardware Kit')

  // --- Invoices ---
  interface InvoiceDef {
    custKey: string
    month: number
    record: Record<string, unknown>
  }
  const invoiceDefs: InvoiceDef[] = []
  CUSTOMERS.forEach((c, ci) => {
    const custId = customerId(c.name)
    for (let month = 0; month < MONTH_COUNT; month++) {
      const revenue = monthlyRevenue(c, month)
      if (revenue <= 0) continue
      const lines: Record<string, unknown>[] = [
        {
          Amount: revenue,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: ITEM_SUBSCRIPTION }, ClassRef: { value: CLASS_CORE } }
        }
      ]
      if (month === c.startMonth) {
        lines.push({
          Amount: 1500 + (ci % 5) * 300,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: ITEM_PS }, ClassRef: { value: CLASS_PS_HW } }
        })
        if (ci % 3 === 0) {
          // Inventory-type items (GPS Hardware Kit) reject an Amount-only line --
          // QuickBooks requires Qty ("Missing Inventory Item Quantity" otherwise).
          // 1 kit per order keeps the existing dollar amounts unchanged (UnitPrice == Amount).
          const hwAmount = 2200 + (ci % 4) * 500
          lines.push({
            Amount: hwAmount,
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: { ItemRef: { value: ITEM_HW }, ClassRef: { value: CLASS_PS_HW }, Qty: 1, UnitPrice: hwAmount }
          })
        }
      }
      const txnDate = isoDate(month, 5)
      invoiceDefs.push({
        custKey: c.key,
        month,
        record: { CustomerRef: { value: custId }, TxnDate: txnDate, DueDate: addDays(txnDate, 30), Line: lines }
      })
    }
  })

  console.log(`Creating ${invoiceDefs.length} Invoices...`)
  const invoiceResults = await qb.createMany('Invoice', invoiceDefs.map((d) => d.record))
  const invoiceFailures = invoiceResults.filter((r) => !r.ok)
  console.log(`  ${invoiceResults.length - invoiceFailures.length}/${invoiceDefs.length} created`)
  if (invoiceFailures.length) console.log('  sample failure:', JSON.stringify(invoiceFailures[0].error).slice(0, 400))

  // --- Payments: pay every invoice except the most recent month, and half of the one before it ---
  interface PaymentTarget {
    custKey: string
    invoiceId: string
    amount: number
    txnDate: string
  }
  const paymentTargets: PaymentTarget[] = []
  invoiceDefs.forEach((d, i) => {
    const r = invoiceResults[i]
    if (!r.ok || !r.id) return
    const leaveOpen = d.month === MONTH_COUNT - 1 || (d.month === MONTH_COUNT - 2 && d.custKey.length % 2 === 0)
    if (leaveOpen) return
    const line = (d.record.Line as { Amount: number }[]).reduce((sum, l) => sum + l.Amount, 0)
    paymentTargets.push({ custKey: d.custKey, invoiceId: r.id, amount: line, txnDate: addDays(d.record.TxnDate as string, 10) })
  })

  console.log(`Creating ${paymentTargets.length} Payments...`)
  const paymentRecords = paymentTargets.map((p) => ({
    CustomerRef: { value: customerId(CUSTOMERS.find((c) => c.key === p.custKey)!.name) },
    TotalAmt: p.amount,
    TxnDate: p.txnDate,
    DepositToAccountRef: { value: CHECKING },
    Line: [{ Amount: p.amount, LinkedTxn: [{ TxnId: p.invoiceId, TxnType: 'Invoice' }] }]
  }))
  const paymentResults = await qb.createMany('Payment', paymentRecords)
  const paymentFailures = paymentResults.filter((r) => !r.ok)
  console.log(`  ${paymentResults.length - paymentFailures.length}/${paymentRecords.length} created`)
  if (paymentFailures.length) console.log('  sample failure:', JSON.stringify(paymentFailures[0].error).slice(0, 400))

  // --- Vendor Bills: monthly opex, mapped to S&M / G&A / COGS accounts ---
  interface BillDef {
    vendor: string
    account: string
    month: number
    amount: number
  }
  const billDefs: BillDef[] = []
  for (let month = 0; month < MONTH_COUNT; month++) {
    billDefs.push({ vendor: 'CloudHost Infrastructure Ltd', account: 'Hosting & Infrastructure COGS', month, amount: 1800 + activeCustomerCount(month) * 55 })
    billDefs.push({ vendor: 'AdNetwork Partners Co', account: 'Sales & Marketing - Advertising', month, amount: 3500 + (month % 6) * 700 })
    billDefs.push({ vendor: 'Meridian Office Properties LLC', account: 'G&A - Rent & Facilities', month, amount: 3200 })
    if (month % 3 === 1) {
      billDefs.push({ vendor: 'Sterling Legal Group LLP', account: 'G&A - Legal & Professional', month, amount: 1500 + (month % 4) * 600 })
    }
  }

  console.log(`Creating ${billDefs.length} Bills...`)
  const billRecords = billDefs.map((b) => {
    const txnDate = isoDate(b.month, 3)
    return {
      VendorRef: { value: vendorId(b.vendor) },
      TxnDate: txnDate,
      DueDate: addDays(txnDate, 30),
      Line: [
        {
          Amount: b.amount,
          DetailType: 'AccountBasedExpenseLineDetail',
          AccountBasedExpenseLineDetail: { AccountRef: { value: acctId(b.account) } }
        }
      ]
    }
  })
  const billResults = await qb.createMany('Bill', billRecords)
  const billFailures = billResults.filter((r) => !r.ok)
  console.log(`  ${billResults.length - billFailures.length}/${billRecords.length} created`)
  if (billFailures.length) console.log('  sample failure:', JSON.stringify(billFailures[0].error).slice(0, 400))

  // --- BillPayments: pay off every bill except the most recent month (A/P aging) ---
  interface BillPaymentTarget {
    vendor: string
    billId: string
    amount: number
    txnDate: string
  }
  const billPaymentTargets: BillPaymentTarget[] = []
  billDefs.forEach((b, i) => {
    const r = billResults[i]
    if (!r.ok || !r.id) return
    if (b.month === MONTH_COUNT - 1) return
    billPaymentTargets.push({ vendor: b.vendor, billId: r.id, amount: b.amount, txnDate: addDays(isoDate(b.month, 3), 20) })
  })

  console.log(`Creating ${billPaymentTargets.length} BillPayments...`)
  const billPaymentRecords = billPaymentTargets.map((p) => ({
    VendorRef: { value: vendorId(p.vendor) },
    TotalAmt: p.amount,
    TxnDate: p.txnDate,
    PayType: 'Check',
    CheckPayment: { BankAccountRef: { value: CHECKING } },
    Line: [{ Amount: p.amount, LinkedTxn: [{ TxnId: p.billId, TxnType: 'Bill' }] }]
  }))
  const billPaymentResults = await qb.createMany('BillPayment', billPaymentRecords)
  const bpFailures = billPaymentResults.filter((r) => !r.ok)
  console.log(`  ${billPaymentResults.length - bpFailures.length}/${billPaymentRecords.length} created`)
  if (bpFailures.length) console.log('  sample failure:', JSON.stringify(bpFailures[0].error).slice(0, 400))

  // --- Journal Entries: monthly payroll + D&A (including COGS-embedded D&A per the metrics guide's warning) ---
  const SM_SALARIES = acctId('Sales & Marketing - Salaries')
  const GA_SALARIES = acctId('G&A - Salaries')
  const DA_TOP = acctId('Depreciation & Amortization')
  const DA_COGS = acctId('Depreciation (COGS-embedded)')
  const DEPRECIATION_CONTRA = acctId('Depreciation') // existing default Fixed Asset account, used as the D&A credit side

  const jeRecords: Record<string, unknown>[] = []
  for (let month = 0; month < MONTH_COUNT; month++) {
    const smAmount = 15000 + month * 250
    const gaAmount = 22000 + month * 300
    jeRecords.push({
      TxnDate: isoDate(month, 28),
      Line: [
        { Amount: smAmount, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: SM_SALARIES } } },
        { Amount: gaAmount, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: GA_SALARIES } } },
        { Amount: smAmount + gaAmount, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: CHECKING } } }
      ]
    })

    const daTop = 1800 + month * 40
    const daCogs = 700 + month * 15
    jeRecords.push({
      TxnDate: isoDate(month, 28),
      Line: [
        { Amount: daTop, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: DA_TOP } } },
        { Amount: daCogs, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: DA_COGS } } },
        { Amount: daTop + daCogs, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: DEPRECIATION_CONTRA } } }
      ]
    })
  }

  console.log(`Creating ${jeRecords.length} Journal Entries...`)
  const jeResults = await qb.createMany('JournalEntry', jeRecords)
  const jeFailures = jeResults.filter((r) => !r.ok)
  console.log(`  ${jeResults.length - jeFailures.length}/${jeRecords.length} created`)
  if (jeFailures.length) console.log('  sample failure:', JSON.stringify(jeFailures[0].error).slice(0, 400))

  console.log('QuickBooks transactions phase complete.')
  await closeDb()
}

main().catch((e) => {
  console.error('QuickBooks transactions seed failed:', e.response?.data ?? e.message)
  process.exit(1)
})
