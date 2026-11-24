import { extractLeafAccountsByColumn } from './src/modules/metrics/service/reportParser'
const r: any = { Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Sep 2026' }, { ColTitle: 'Oct 2026' }] },
  Rows: { Row: [{ group: 'FixedAssets', Header: { ColData: [{ value: 'Fixed Assets' }, { value: '' }, { value: '' }] }, Rows: { Row: [
    { Header: { ColData: [{ value: '1510 Computer Equipment', id: '90' }, { value: '' }, { value: '' }] },
      Rows: { Row: [{ ColData: [{ value: '1590 Accumulated Depreciation', id: '91' }, { value: '-1000' }, { value: '-1100' }] }] },
      Summary: { ColData: [{ value: 'Total 1510 Computer Equipment' }, { value: '4000' }, { value: '4500' }] } },
    { ColData: [{ value: '1515 Furniture & Fixtures', id: '92' }, { value: '248400' }, { value: '248400' }] } ] },
    Summary: { ColData: [{ value: 'Total Fixed Assets' }, { value: '252400' }, { value: '252900' }] } }] } }
console.log(JSON.stringify(extractLeafAccountsByColumn(r)))
