const { Client } = require("@notionhq/client")
const dotenv = require("dotenv")
const csv = require("csvtojson")
const fs = require("fs")
dotenv.config()

const notion = new Client({ auth: process.env.NOTION_KEY })
const caseDatabaseId = process.env.NOTION_CASE_DATABASE_ID
const algDatabaseId = process.env.NOTION_ALG_DATABASE_ID
const csvDir = __dirname+"/asset/allAlgs.csv"
const caseJsonDir = __dirname+"/asset/casePageId.json"
const slice_size = 80 // less pages each time to prevent error

async function main() {
  // Get json array data for caseDb from csv file
  const caseDbData = await readCsv(csvDir)

  // When working for a new database, or add other algset, init caseDb and algDb
  // await createInit(caseDbData)

  // Get json array data for algDb from caseDbData and casePageId.json
  const algDbData = transformAlgData(caseDbData, readJson(caseJsonDir))

  // When data updated from SpeedCubeDB, create added algs, and update wrong ranks
  await createAndUpdateRank(algDbData)
}

//*========================================================================
// Combined functions
//*========================================================================

/**
 * When working for a new database, or add other algset.
 * Init caseDb and algDb
 *
 * @param caseDbData: Array<{ name: string, algset: string, ... }>
 */
async function createInit(caseDbData) {  
  // 1. Add all alg cases to case db
  await doWithSliced(createCasePages, caseDbData, slice_size)

  // 2. Get existing pages in the database, and write to pageId json file
  const casePages = await queryCaseDb()
  writeJson(caseJsonDir, casePages)

  // 3. read pageId json file, and create json array as { alg, name, rank, pageId }
  const casePagesRead = readJson(caseJsonDir)
  const algDbData = transformAlgData(caseDbData, casePagesRead)

  // 4. Add all algs to alg db
  await doWithSliced(createAlgPages, algDbData, slice_size)
}

/**
 * When data updated from SpeedCubeDB.
 * Create added algs, and update wrong ranks
 *
 * @param algDbData: Array<{ alg: string, rank: number, name: string, casePageId: string }>
 */
async function createAndUpdateRank(algDbData) {
  console.log("Start query AlgDb...")
  const algPages = await queryAlgDb()
  console.log("AlgDb query is done!")
  const algsToCreate = getAlgsToCreate(algDbData, algPages)
  const algsToUpdate = getAlgsToUpdate(algDbData, algPages)
  console.log("Creating " + algsToCreate.length + " items...")
  await doWithSliced(createAlgPages, algsToCreate, slice_size)
  console.log("Creating is done!")
  console.log("Updating " + algsToUpdate.length + " alg ranks...")
  await doWithSliced(updateAlgRank, algsToUpdate, slice_size)
  console.log("Updating rank is done!")
}
//*========================================================================
// Requests
//*========================================================================

/**
 * Adds pages to case database
 *
 * @param caseDbData: Array<{ name: string, algset: string, ... }>
 */
async function createCasePages(caseDbData) {
  const isEmpty = await isEmptyDb(caseDatabaseId)
  if (!isEmpty) {
    return
  }
  await Promise.all(
    caseDbData.map(({ name, algset, caseid, catalog, alg1, alg2, alg3, alg4, video, videoimg, color, orientation }) =>
      notion.pages.create({
        parent: { database_id: caseDatabaseId },
        properties: {
          name: { title: [{ text: { content: name }}]},
          algset: { select: { name: algset }},
          caseid: { rich_text: [{ text: { content: caseid }}]},
          catalog: { rich_text: [{ text: { content: catalog }}]},
          alg1: { rich_text: [{ text: { content: alg1 }}]},
          alg2: { rich_text: [{ text: { content: alg2 }}]},
          alg3: { rich_text: [{ text: { content: alg3 }}]},
          alg4: { rich_text: [{ text: { content: alg4 }}]},
          video: { url: video!==""?video:null}, // "" is not allowed for url properties
          videoimg: { url: videoimg!==""?videoimg:null},
          color: { rich_text: [{ text: { content: color }}]},
          orientation: { select: { name: orientation }},
        },
      })
    )
  )
}

/**
 * Query the case database
 *
 * Returns array of objects with name property and pageId
 * Array<{ name: string, pageId: string }>
 */
async function queryCaseDb() {
  let pages = []
  let cursor = undefined
  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: caseDatabaseId,
      sorts: [{ property: "name", direction: "ascending" }],
      page_size: 100,
      start_cursor: cursor,
    })
    pages.push(...results)
    if (!next_cursor) {
      break
    }
    cursor = next_cursor
  }
  return pages.map(page => {
    const titleProperty = page.properties["name"]
    const richText = titleProperty.title
    const name = richText.map(({ plain_text }) => plain_text).join("")
    return { name, pageId: page.id }
  })
}

/**
 * Adds pages to alg database
 *
 * @param algDbData: Array<{ alg: string, rank: number, name: string, casePageId: string }>
 */
async function createAlgPages(algDbData) {
  await Promise.all(
    algDbData.map(({ alg, rank, name, casePageId }) =>
      notion.pages.create({
        parent: { database_id: algDatabaseId },
        properties: {
          alg: { title: [{ text: { content: alg }}]},
          rank: { number: rank },
          name: { rich_text: [{ text: { content: name }}]},
          case_relation: { relation: [{ id: casePageId }]},
        },
      })
    )
  )
}

/**
 * Create or update database pages with sliced size (less pages each time to prevent error)
 *
 * @param func: function to create or update database pages
 * @param data: Array for func input
 */
async function doWithSliced(func ,data, slice_size) {
  const data_len = data.length
  for (var i = 0; i < data.length; i = i + slice_size) {
    await func(data.slice(i, i + slice_size))
  }
}

/**
 * Query the alg database
 *
 * Returns array of objects with alg, rank, name properties and pageId
 * Array<{ alg: string, rank: number, name: string, pageId: string }>
 */
 async function queryAlgDb() {
  let pages = []
  let cursor = undefined
  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: algDatabaseId,
      sorts: [{ property: "name", direction: "ascending" }, { property: "rank", direction: "ascending" }],
      page_size: 100,
      start_cursor: cursor,
    })
    pages.push(...results)
    console.log(pages.length + " pages")
    if (!next_cursor) {
      break
    }
    cursor = next_cursor
  }
  return pages.map(page => {
    const alg = page.properties["alg"].title.map(({ plain_text }) => plain_text).join("")
    const rank = page.properties["rank"].number
    const name = page.properties["name"].rich_text.map(({ plain_text }) => plain_text).join("")
    return { alg, rank, name, pageId: page.id }
  })
}

/**
 * Update pages with the wrong rank in alg database
 *
 * @param algsToUpdate: Array<{ rank: number, pageId: string }>
 */
async function updateAlgRank(algsToUpdate) {
  await Promise.all(
    algsToUpdate.map(({ rank, pageId }) =>
      notion.pages.update({
        page_id: pageId,
        properties: {
          rank: { number: rank },
        },
      })
    )
  )
}

//*========================================================================
// Helpers
//*========================================================================

/**
 * Returns true if DB is empty
 * Prevents duplication
 */
async function isEmptyDb(databaseId) {
  const { results } = await notion.databases.query({
    database_id: databaseId,
  })
  return results.length === 0
}

/**
 * Reads json objects from csv
 * 
 * @param dir: string
 * Returns Array of objects
 */
async function readCsv(dir) {
  return await csv().fromFile(dir)
}

/**
 * Write objects to json file
 * 
 * @param dir: string
 * @param data: Array of objects
 */
 function writeJson(dir, data) {
  fs.writeFileSync(dir, JSON.stringify(data, null, "  "))
}

/**
 * Read json objects from json file
 * 
 * @param dir: string
 * 
 * Returns Array of objects
 */
function readJson(dir) {
  const data = fs.readFileSync(dir)
  return JSON.parse(data)
}

/**
 * Combine name, algs from caseDbData and pageId from casePages
 * Change the structure to { alg, name, rank, casePageId }
 *
 * @param caseDbData: Array<{ name: string, algset: string, ... }>
 * @param casePages: Array<{ name: string, pageId: string }>
 *
 * Returns algs of each case with rank
 * Array<{ alg: string, rank: number, name: string, casePageId: string }>
 */
function transformAlgData(caseDbData, casePages) {
  return caseDbData.map((x, i) => {
    return [x.alg1, x.alg2, x.alg3, x.alg4].filter(Boolean).map((alg, alg_index) => {
      return {alg: alg, rank: alg_index+1, name: x.name, casePageId: casePages[i].pageId}
    })
  }).flat()
}

/**
 * Compare algDbData (newData) with algPages (oldData), those undifined need to create
 *todo
 * @param algDbData: Array<{ alg: string, rank: number, name: string, casePageId: string }>
 * @param algPages: Array<{ alg: string, rank: number, name: string, pageId: string }>
 *
 * Returns algs needs to create
 * Array<{ alg: string, rank: number, name: string, casePageId: string }>
 */
function getAlgsToCreate(algDbData, algPages) {
  const algsToCreate = algDbData.reduce((algsToCreate, newData) => {
    if (algPages.find(x => x.alg === newData.alg) === undefined) algsToCreate.push(newData)
    return algsToCreate
  }, [])
  return algsToCreate
}

/**
 * Compare algPages (oldData) with algDbData (newData), update wrong rank (undifined will be 5)
 *
 * @param algDbData: Array<{ alg: string, rank: number, name: string, casePageId: string }>
 * @param algPages: Array<{ alg: string, rank: number, name: string, pageId: string }>
 *
 * Returns algs' rank needs to update
 * Array<{ rank: number, pageId: string }>
 */
function getAlgsToUpdate(algDbData, algPages) {
  const algsToUpdate = algPages.reduce((algsToUpdate, oldData) => {
    const newData = algDbData.find(x => x.alg === oldData.alg)
    if (newData === undefined || newData.rank !== oldData.rank) algsToUpdate.push({rank: (newData === undefined) ? 5 : newData.rank, pageId: oldData.pageId})
    return algsToUpdate
  }, [])
  return algsToUpdate
}

main()
