import { getInstruments } from '../api/trading212.js'

const instruments = await getInstruments()

const query = process.argv[2]?.toLowerCase()

const list = [...instruments.values()]
  .filter((i) => !query || i.ticker.toLowerCase().includes(query) || i.name.toLowerCase().includes(query) || i.shortName.toLowerCase().includes(query))
  .sort((a, b) => a.ticker.localeCompare(b.ticker))

console.log(`\n${'Ticker'.padEnd(20)} ${'Short Name'.padEnd(16)} ${'Currency'.padEnd(10)} Name`)
console.log('─'.repeat(90))
for (const i of list) {
  console.log(`${i.ticker.padEnd(20)} ${i.shortName.padEnd(16)} ${i.currencyCode.padEnd(10)} ${i.name}`)
}
console.log(`\n${list.length} instrument(s)${query ? ` matching "${query}"` : ''}\n`)
