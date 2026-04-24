const chokidar = require('chokidar')
const fs = require('fs')
const path = require('path')

// Resolve from this package so it works even when process.cwd() is not the server root (common on Windows).
const serverRoot = path.normalize(path.join(__dirname, '..', '..'))
const hotloaderRoot = path.join(serverRoot, 'hotloader')
const hotServerDir = path.normalize(path.join(hotloaderRoot, 'server'))
const hotClientDir = path.normalize(path.join(hotloaderRoot, 'client'))

function dirsMatch(dirA, dirB) {
  const a = path.normalize(dirA)
  const b = path.normalize(dirB)
  if (process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase()
  }
  return a === b
}

let watcher = chokidar.watch(hotloaderRoot, { ignoreInitial: true })
let hotloaderVars = []

let clearVars = () => {
  hotloaderVars.forEach(variable => {
    if (variable) {
      if (variable instanceof mp.Event) {
        variable.destroy()

      } else if (variable.type) {
        if (variable.type != 'player') {
          if (mp?.[variable.type +'s']?.exists(variable)) {
            variable.destroy()
          }
        }
      }
    }
  })
  hotloaderVars = []
}

let lastEval
watcher.on('ready', () => {
  console.log(`Hot loader watching: ${hotloaderRoot}`)
  watcher.on('change', filePath => {
    if (path.extname(filePath) !== '.js') return
    // 1 sec delay to fix sending code twice
    if (lastEval && (Date.now() - lastEval) < 1000 ) return
    lastEval = Date.now()
    console.log(`Hot loader: Changed >> ${filePath}`)

    let file = fs.readFileSync(filePath)
    file = file.toString()

    const changedDir = path.normalize(path.dirname(filePath))

    if (dirsMatch(changedDir, hotServerDir)) {
      try {
        clearVars()
        // remove comments
        file = file.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '');
        let matches = file.matchAll(/(let|var)\s+([^\s{].*) = .*/gi)
        matches = [...matches]
        let vars = []
        // parse variables
        matches.forEach(arr => vars.push(`typeof  ${arr[2]} != 'undefined' && ${arr[2]}`));

        file += `
        \n\n
        let _vars = [${vars}]
        _vars.forEach(_var => {
          if (_var) {
            hotloaderVars.push(_var)
          }
        })
        `
        eval(file)
      } catch (error) {
        console.error('[HOT LOADER] Error: ', error)
      }
      return

    } else if (!dirsMatch(changedDir, hotClientDir)) {
      return
    }

    let players = []
    let execTo = file.match(/executeTo\s*=\s*\[(.*)\]/)
    if (execTo) {
      const raw = execTo[1].trim()
      if (raw.length) {
        players = raw
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((id) => !Number.isNaN(id))
          .map((id) => mp.players.at(id))
          .filter((p) => p != null)
      }
    }
    if (!players.length) {
      players = mp.players.toArray().filter((p) => p && mp.players.exists(p))
    }

    if (!players.length) {
      console.warn('[hot-loader] No players online; connect and save client.js again.')
      return
    }

    const sample = players[0]
    if (typeof sample.eval !== 'function') {
      console.error(
        '[hot-loader] player.eval is missing on this server build. Hot client reload requires a dev / JS eval-capable server.'
      )
      return
    }

    // remove comments
    file = file.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '')
    let matches = file.matchAll(/(let|var)\s+([^\s{].*) = .*/gi)
    matches = [...matches]
    let vars = []
    matches.forEach((arr) => vars.push(`typeof  ${arr[2]} != 'undefined' && ${arr[2]}`))
    file += `
      \n\n
      let _vars = [${vars}]
      _vars.forEach(_var => {
        if (_var) {
          hotloaderVars.push(_var)
        }
      })
      `

    const codePayload = JSON.stringify(file)

    console.log(`[hot-loader] Pushing client bundle to ${players.length} player(s).`)

    players.forEach((pl) => {
      try {
      pl.eval(`
        if (!hotloaderVars) {
          var hotloaderVars = []
          var hotloaderRender = null
          var hotloaderErrTimeout = null
          var cleanVars = () => {
            hotloaderVars.forEach(variable => {
              if (variable) {
                if (variable instanceof mp.Event) {
                  variable.destroy()
                } else if (variable.type) {
                  if (variable.type != 'player') {
                    if (mp?.[variable.type +'s']?.exists(variable)) {
                      variable.destroy()
                    }
                  }
                }
              }
            })
            hotloaderVars = []
          }
          var runhotcode = (code) => {
            try {
              if (hotloaderRender && hotloaderRender.destroy)
                hotloaderRender.destroy()
              cleanVars()
              // new Function(code) runs in an isolated scope; RAGE global mp is not in scope unless passed.
              let func = new Function('mp', code)
              func(mp)
            } catch (e) {
              var errText = (e && e.stack) ? String(e.stack) : String(e)
              hotloaderRender = new mp.Event('render', ()=> {
                mp.game.graphics.drawText('[hot-loader] Error: ', [0.15,0.35], {
                  font: 0,
                  scale: [0.65, 0.65],
                  color: [255,0,0,255]
                })
                mp.game.graphics.drawText(errText, [0.25,0.40], {
                  font: 0,
                  scale: [0.40, 0.40],
                  color: [0,255,0,255]
                })
              })
              if (hotloaderErrTimeout) {
                clearTimeout(hotloaderErrTimeout)
              }
              hotloaderErrTimeout = setTimeout(()=> {
                hotloaderRender.destroy()
              }, 5000)
            }
          }
        }
        cleanVars()
        runhotcode(${codePayload})
      `)
      } catch (err) {
        console.error(`[hot-loader] pl.eval failed for ${pl.name}:`, err)
      }
    })
  })
})

function _import(path) {
  return import('../'+path)
}