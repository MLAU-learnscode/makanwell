import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const inputFile = path.join(rootDir, 'HealthierEateries.geojson')
const outputFile = path.join(rootDir, 'public', 'hawker_eateries.json')
const regionFile = path.join(rootDir, 'src', 'data', 'postalRegions.json')

const expectedClassificationFields = ['fnb_setting', 'category', 'sub_category', 'location_type']

const includePatterns = [
  /\bhawker\b/i,
  /\bfood centre\b/i,
  /\bcoffee\s?shop\b/i,
  /\bkopitiam\b/i,
  /\bcanteen\b/i,
  /\beating house\b/i,
  /\bchicken rice\b/i,
  /\bhainanese\b/i,
  /\bnasi\b/i,
  /\bmee\b/i,
  /\bnoodle/i,
  /\bkway\b/i,
  /\bbee hoon\b/i,
  /\bban mian\b/i,
  /\bfish soup\b/i,
  /\byong tau foo\b/i,
  /\bprata\b/i,
  /\bthosai\b/i,
  /\bbiryani\b/i,
  /\bpopiah\b/i,
  /\brojak\b/i,
  /\bporridge\b/i,
  /\bmixed rice\b/i,
  /\bcai fan\b/i,
  /\bvegetarian\b/i,
  /\bwarong\b/i,
  /\bteh tarik\b/i,
]

const excludePatterns = [
  /\bmcdonald/i,
  /\bburger king\b/i,
  /\bsubway\b/i,
  /\bkfc\b/i,
  /\bpizza hut\b/i,
  /\bdomino/i,
  /\bjollibee\b/i,
  /\bpopeyes\b/i,
  /\blong john/i,
  /\bmos burger\b/i,
  /\btexas chicken\b/i,
  /\bstarbucks\b/i,
  /\bcoffee bean\b/i,
  /\bdal\.?komm\b/i,
  /\bboost\b/i,
  /\bkoi\b/i,
  /\bliho\b/i,
  /\bgong cha\b/i,
  /\beach a cup\b/i,
  /\bmr bean\b/i,
  /\bold chang kee\b/i,
  /\bbreadtalk\b/i,
  /\bfour leaves\b/i,
  /\bpolar\b/i,
  /\bchateraise\b/i,
  /\byamazaki\b/i,
  /\bnick vina\b/i,
  /\bswee heng\b/i,
  /\bbakery\b/i,
  /\btoast box\b/i,
  /\bya kun\b/i,
  /\bmarche\b/i,
  /\bjack'?s place\b/i,
  /\bsakae sushi\b/i,
  /\bsoup restaurant\b/i,
  /\bsoup spoon\b/i,
  /\bswensen\b/i,
  /\bsaizeriya\b/i,
  /\bpapparich\b/i,
  /\bhockhua\b/i,
  /\bkiosk\b/i,
]

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function countBy(items, getter) {
  return items.reduce((acc, item) => {
    const key = getter(item) || '<blank>'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function printTopCounts(title, counts, limit = 20) {
  console.log(`\n${title}`)
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .forEach(([value, count]) => console.log(`${count}\t${value}`))
}

function compactAddress(properties) {
  return [
    properties.ADDRESSBLOCKHOUSENUMBER,
    properties.ADDRESSBUILDINGNAME,
    properties.ADDRESSSTREETNAME,
    properties.ADDRESSFLOORNUMBER ? `#${properties.ADDRESSFLOORNUMBER}` : '',
    properties.ADDRESSUNITNUMBER,
    properties.ADDRESSPOSTALCODE ? `Singapore ${properties.ADDRESSPOSTALCODE}` : '',
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ')
}

function buildSectorLookup(regionConfig) {
  const lookup = new Map()
  for (const [region, sectors] of Object.entries(regionConfig.regions)) {
    for (const sector of sectors) lookup.set(sector, region)
  }
  return lookup
}

function getRegion(postalCode, sectorLookup) {
  const postal = String(postalCode || '').trim()
  if (!/^\d{2}/.test(postal)) return 'Unknown'
  return sectorLookup.get(postal.slice(0, 2)) || 'Unknown'
}

function hasAny(patterns, value) {
  return patterns.some((pattern) => pattern.test(value))
}

function isStrictLocalEatery(feature) {
  const properties = feature.properties || {}
  const searchable = [
    properties.NAME,
    properties.ADDRESSBUILDINGNAME,
    properties.ADDRESSSTREETNAME,
    properties.DESCRIPTION,
  ].join(' ')

  // ponytail: all 1829 entries are HPB-certified; just exclude fast food chains
  return !hasAny(excludePatterns, searchable)
}

const data = readJson(inputFile)
const regionConfig = readJson(regionFile)
const sectorLookup = buildSectorLookup(regionConfig)
const features = Array.isArray(data.features) ? data.features : []
const propertyKeys = [...new Set(features.flatMap((feature) => Object.keys(feature.properties || {})))].sort()
const missingExpected = expectedClassificationFields.filter((field) => !propertyKeys.includes(field))

console.log(`Loaded ${features.length} features from ${path.relative(rootDir, inputFile)}`)
console.log(`Property keys: ${propertyKeys.join(', ')}`)
console.log(`Missing expected classification fields: ${missingExpected.join(', ') || 'none'}`)

for (const field of ['fnb_setting', 'category', 'sub_category', 'location_type', 'ADDRESSTYPE', 'DESCRIPTION', 'ADDRESSBUILDINGNAME']) {
  if (propertyKeys.includes(field)) {
    printTopCounts(`Top values for ${field}:`, countBy(features, (feature) => String(feature.properties?.[field] || '').trim()))
  }
}

const cleaned = features
  .filter(isStrictLocalEatery)
  .map((feature, index) => {
    const properties = feature.properties || {}
    const postalCode = String(properties.ADDRESSPOSTALCODE || '').trim()
    const region = getRegion(postalCode, sectorLookup)

    return {
      id: `eatery_${String(index + 1).padStart(4, '0')}`,
      name: String(properties.NAME || '').trim(),
      address: compactAddress(properties),
      postalCode,
      region,
      coordinates: feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null,
      source: 'HealthierEateries.geojson',
      properties: {
        ...properties,
        CLUSTER_REGION: region,
      },
    }
  })
  .filter((eatery) => eatery.name && eatery.postalCode)

printTopCounts('\nRegion counts after strict filtering:', countBy(cleaned, (eatery) => eatery.region), 10)
console.log(`\nRetained ${cleaned.length} strict local eateries.`)

fs.writeFileSync(outputFile, `${JSON.stringify(cleaned, null, 2)}\n`)
console.log(`Wrote ${path.relative(rootDir, outputFile)}`)
