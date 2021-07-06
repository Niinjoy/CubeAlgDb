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
const algJsonDir = __dirname+"/asset/algPageInfo.json"
const faveJsonDir = __dirname+"/asset/algFave.json"
const slice_size = 80 // less pages each time to prevent error

async function main() {
  // Get json array data for caseDb from csv file generated by getData.py
  const caseDbData = await readCsv(csvDir)

  // When working for a new database, or add other algset, init caseDb and algDb
  // await createInit(caseDbData)

  // When data updated from SpeedCubeDB, create added algs, and update wrong ranks and faves
  await updateRankAndFave(caseDbData)
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
  // Get the algsets had added to caseDb
  const addedAlgset =  await getAddedAlgset()
  // Subtract added cases in caseDbData
  const caseDbDataNew = caseDbData.reduce((caseDbDataNew, data) => {
    if (addedAlgset.indexOf(data.algset) === -1) caseDbDataNew.push(data)
    return caseDbDataNew
  }, [])  
  // Add all alg cases to case db
  console.log("Adding " + caseDbDataNew.length + " cases to caseDb...")
  await doWithSliced(createCasePages, caseDbDataNew, slice_size)
  console.log(caseDbDataNew.length + " cases added!")

  // If new cases added to caseDb, get existing pages in the database, and write to pageId json file
  // const casePages = await queryCaseDb()
  
  // Read pageId json file
  const casePagesRead = readJson(caseJsonDir)

  // Add relation of different oreintations with main oreintation for F2L, just need to do once
  await doWithSliced(addOrientRelation, getOrientRelation(casePagesRead, "F2L"), slice_size)

  // Create json array as { alg, name, rank, pageId } for algDb
  const algDbData = transformAlgData(caseDbDataNew, casePagesRead)
  // Add all algs to alg db
  console.log("Adding " + algDbData.length + " algs to algDb...")
  await doWithSliced(createAlgPages, algDbData, slice_size)
  console.log(algDbData.length + " algs added!")
}

/**
 * When data updated from SpeedCubeDB.
 * Create added algs, and update wrong ranks and faves
 *
 * @param caseDbData: Array<{ name: string, algset: string, ... }>
 */
async function updateRankAndFave(caseDbData) {
  // run this line if program shut down after create algs and before querAlgDb, to make sure the json file is same as algDb
  // await queryAlgDb()

  // Get json array data for algDb from caseDbData and casePageId.json
  const algDbData = transformAlgData(caseDbData, readJson(caseJsonDir))

  const algPagesRead = readJson(algJsonDir)
  
  await createAndUpdateRank(algDbData, algPagesRead)

  // When your favorate data is created or changed, run getFave.js first.
  await upadateFave(algPagesRead)

  // Query algDb, and save to json file. Time consuming.
  await queryAlgDb()

  // Update alg_relation of algs to case follow alg ranks
  console.log("Updating alg_relation for caseDb...")
  await doWithSliced(updateAlgRelation, getAlgRelation(algPagesRead), slice_size)
  console.log("Alg_relation updated for caseDb!")
}

/**
 * When data updated from SpeedCubeDB.
 * Create added algs, and update wrong ranks
 *
 * @param algDbData: Array<{ alg: string, rank: number, name: string, casePageId: string }>
 * @param algPagesRead: Array<{ alg: string, rank: number, name: string, fave: bool, pageId: string }>
 */
 async function createAndUpdateRank(algDbData, algPagesRead) {
  const algsToCreate = getAlgsToCreate(algDbData, algPagesRead)
  const algsToUpdate = getAlgsToUpdateRank(algDbData, algPagesRead)
  console.log("Updating " + algsToUpdate.length + " alg ranks...")
  await doWithSliced(updateAlgRank, algsToUpdate, slice_size)
  console.log("Updating rank is done!")
  console.log("Creating " + algsToCreate.length + " items...")
  await doWithSliced(createAlgPages, algsToCreate, slice_size)
  console.log("Creating is done!")
}

/**
 * When your favorate data is created or changed, sync to Notion Db
 *
 * @param algPagesRead: Array<{ alg: string, rank: number, name: string, fave: bool, pageId: string }>
 */
 async function upadateFave(algPagesRead) {
  const algsToUpdate = getAlgsToUpdateFave(algPagesRead)
  console.log("Updating " + algsToUpdate.length + " alg faves...")
  await doWithSliced(updateAlgFave, algsToUpdate, slice_size)
  console.log("Updating fave is done!")
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
//*========================================================================
// Requests
//*========================================================================

/**
 * Adds pages to case database
 *
 * @param caseDbData: Array<{ name: string, algset: string, ... }>
 */
async function createCasePages(caseDbData) {
  await Promise.all(
    caseDbData.map(({ name, algset, caseid, catalog, alg1, alg2, alg3, alg4, video, videoimg, color, orientation }) =>
      notion.pages.create({
        parent: { database_id: caseDatabaseId },
        properties: {
          name: { title: [{ text: { content: name }}]},
          algset: { select: { name: algset }},
          caseid: { rich_text: [{ text: { content: caseid }, annotations: { bold: true }}]},
          catalog: { rich_text: [{ text: { content: catalog }}]},
          // alg1: { rich_text: [{ text: { content: alg1 }}]},
          // alg2: { rich_text: [{ text: { content: alg2 }}]},
          // alg3: { rich_text: [{ text: { content: alg3 }}]},
          // alg4: { rich_text: [{ text: { content: alg4 }}]},
          video: { url: video!==""?video:null}, // "" is not allowed for url properties
          // videoimg: { url: videoimg!==""?videoimg:null},
          // color: { rich_text: [{ text: { content: color }}]},
          orientation: { select: { name: orientation }},
        },
      })
    )
  )
}

/**
 * Query the case database, and add to json file
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
  const casePages = pages.map(page => {
    const titleProperty = page.properties["name"]
    const richText = titleProperty.title
    const name = richText.map(({ plain_text }) => plain_text).join("")
    return { name, pageId: page.id }
  })
  writeJson(caseJsonDir, casePages)
  return casePages
}

/**
 * Update pages with the wrong rank in alg database
 *
 * @param oreintRelation: Array<{ allOrientations: Array<{ id: pageId, id: pageId, id: pageId, id: pageId }>, pageId: string }>
 */
 async function addOrientRelation(oreintRelation) {
  await Promise.all(
    oreintRelation.map(({ allOrientations, pageId }) =>
      notion.pages.update({
        page_id: pageId,
        properties: {
          allOrientations: { relation: allOrientations },
        },
      })
    )
  )
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
 * Query the alg database, and add to json file
 *
 * Returns array of objects with alg, rank, name properties and pageId
 * Array<{ alg: string, rank: number, name: string, fave: bool, pageId: string }>
 */
 async function queryAlgDb() {
  console.log("Start query AlgDb...")
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
  console.log("AlgDb query is done!")
  const algPages = pages.map(page => {
    const alg = page.properties["alg"].title.map(({ plain_text }) => plain_text).join("")
    const rank = page.properties["rank"].number
    const name = page.properties["name"].rich_text.map(({ plain_text }) => plain_text).join("")
    const fave = page.properties["fave"].checkbox
    return { alg, rank, name, fave, pageId: page.id }
  })
  writeJson(algJsonDir, algPages)
  return algPages
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

/**
 * Update pages with the wrong fave in alg database
 *
 * @param algsToUpdate: Array<{ fave: checkbox, pageId: string }>
 */
 async function updateAlgFave(algsToUpdate) {
  await Promise.all(
    algsToUpdate.map(({ fave, pageId }) =>
      notion.pages.update({
        page_id: pageId,
        properties: {
          fave: { checkbox: fave },
        },
      })
    )
  )
}

/**
 * Update alg_relation of algs to case follow alg ranks
 *
 * @param algRelations: Array<{ alg_relation: Array<{ id: pageId, id: pageId, id: pageId, id: pageId }>, pageId: string }>
 */
 async function updateAlgRelation(algRelations) {
  await Promise.all(
    algRelations.map(({ alg_relation, pageId }) =>
      notion.pages.update({
        page_id: pageId,
        properties: {
          alg_relation: { relation: alg_relation },
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
 * Returns the array of algsets added to caseDb
 * Prevents duplication when add other algsets
 * Example: [ 'F2L', 'PLL', 'OLL' ]
 */
 async function getAddedAlgset() {
  const { results } = await notion.databases.query({
    database_id: caseDatabaseId,
    filter: { property: "name", text: { ends_with : "01" }},
    page_size: 100,
  })
  return results.map(result => result.properties["name"].title.map(({ plain_text }) => plain_text.substring(0,plain_text.length-2)).join(""))
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
 * Get relation of different oreintations with main oreintation for algset (currently only for F2L)
 *
 * @param casePages: Array<{ name: string, pageId: string }>
 * @param algset: string
 *
 * Returns all orientations' pageid with main orientation's pageid
 * Array<{ allOrientations: Array<{ id: pageId, id: pageId, id: pageId, id: pageId }>, pageId: string }>
 */
function getOrientRelation(casePagesRead, algset) {
  const oreintRelations = casePagesRead.reduce((oreintRelations, mainPage) => {
    if (mainPage.name.includes(algset) && !mainPage.name.includes("-")) {
      const allOrientations = casePagesRead.reduce((allOrientations, relatedPage) => {
        if (relatedPage.name.includes(mainPage.name)) allOrientations.push({id: relatedPage.pageId})
        return allOrientations
      }, [])    
      oreintRelations.push({allOrientations: allOrientations, pageId: mainPage.pageId})
    }
    return oreintRelations
  }, [])
  return oreintRelations
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
 *
 * @param algDbData: Array<{ alg: string, rank: number, name: string, casePageId: string }>
 * @param algPages: Array<{ alg: string, rank: number, name: string, fave: bool, pageId: string }>
 *
 * Returns algs needs to create
 * Array<{ alg: string, rank: number, name: string, casePageId: string }>
 */
function getAlgsToCreate(algDbData, algPages) {
  const algsToCreate = algDbData.reduce((algsToCreate, newData) => {
    if (algPages.find(x => x.alg === newData.alg && x.name === newData.name) === undefined) algsToCreate.push(newData)
    return algsToCreate
  }, [])
  return algsToCreate
}

/**
 * Compare algPages (oldData) with algDbData (newData), update wrong rank (undifined will be 5)
 *
 * @param algDbData: Array<{ alg: string, rank: number, name: string, casePageId: string }>
 * @param algPages: Array<{ alg: string, rank: number, name: string, fave: bool, pageId: string }>
 *
 * Returns algs' rank needs to update
 * Array<{ rank: number, pageId: string }>
 */
function getAlgsToUpdateRank(algDbData, algPages) {
  const algsToUpdate = algPages.reduce((algsToUpdate, oldData) => {
    const newData = algDbData.find(x => x.alg === oldData.alg && x.name === oldData.name)
    if (newData === undefined && oldData.rank !== 5) algsToUpdate.push({rank: 5, pageId: oldData.pageId})
    if (newData !== undefined && newData.rank !== oldData.rank) algsToUpdate.push({rank: newData.rank, pageId: oldData.pageId})
    return algsToUpdate
  }, [])
  return algsToUpdate
}

/**
 * Compare algPages (oldData) with algFave (newData), update wrong fave
 *
 * @param algPages: Array<{ alg: string, rank: number, name: string, fave: bool, pageId: string }>
 *
 * Returns algs' fave needs to update
 * Array<{ fave: bool, pageId: string }>
 */
function getAlgsToUpdateFave(algPages) {
  algFave = readJson(faveJsonDir)
  const algsToUpdate = algPages.reduce((algsToUpdate, oldData) => {
    const newData = algFave.find(x => x.alg === oldData.alg && oldData.name.includes(x.algset))
    if (newData === undefined && oldData.fave === true) algsToUpdate.push({fave: false, pageId: oldData.pageId})
    if (newData !== undefined && oldData.fave === false) algsToUpdate.push({fave: true, pageId: oldData.pageId})
    return algsToUpdate
  }, [])
  return algsToUpdate
}

/**
 * Get relation of algs to case follow alg ranks
 *
 * @param algPagesRead: Array<{ alg: string, rank: number, name: string, fave: bool, pageId: string }>
 *
 * Returns algs' pageid with case's pageid
 * Array<{ alg_relation: Array<{ id: pageId, id: pageId, id: pageId, id: pageId }>, pageId: string }>
 */
function getAlgRelation(algPagesRead) {
  const casePagesRead = readJson(caseJsonDir)
  const algRelations = casePagesRead.map( casePage => {
    const algPages = algPagesRead.reduce((algPages, algPage) => {
      if (algPage.name === casePage.name) algPages.push({id: algPage.pageId})
      return algPages
    }, [])    
    return {alg_relation: algPages, pageId: casePage.pageId}
  }, [])
  return algRelations
}

main()
