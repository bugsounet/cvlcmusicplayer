const mm = require('music-metadata')
var base64Img = require('base64-img')
const USB = require('usb') // needed: sudo apt-get install build-essential libudev-dev
const Drives = require('drivelist')
const cvlc = require("@bugsounet/cvlc")
const path = require("path")
const fs = require("fs")

var _log = function() {
    var context = "[MUSIC]"
    return Function.prototype.bind.call(console.log, console, context)
}()

var log = function() {
  //do nothing
}

class PLAYER {
  constructor(config, debug, callback = ()=>{}) {
    this.config= config
    this.default = {
      useUSB: false,
      modulePath: "./",
      musicPath: "/home",
      checkSubDirectory: false,
      autoStart: false
    }
    this.config = Object.assign(this.default, this.config)
    this.sendSocketNotification = callback.sendSocketNotification
    if (debug == true) log = _log
    this.init()
    this.forceStop = false
    this.EndWithNoCb = false
    this.FileExtensions = ['mp3','flac','wav', 'ogg', 'opus', 'm4a']
    if (this.config.useUSB) this.USBAutoDetect()
    console.log("[MUSIC] Music Player Loaded")
  }

  init () {
    // Init or Re-init all value :)
    this.Music = null
    this.MusicPlayerStatus = {
      connected: false,
      current: 0,
      duration: 0,
      file: null,
      title: "",
      artist: "",
      volume: 0,
      date: 0,
      seed: 0,
      cover: null,
      id: null,
      idMax: 0
    }
    this.MusicInterval = null
    this.audioList= []
  }

  async start () {
    if (this.config.useUSB) { // USB Key is already connected !
      await this.USBSearchDrive()
    }
    else await this.search(this.config.musicPath)
    if (this.audioList.length) {
      log("Audio files Found:", this.audioList.length)
      if (this.config.autoStart) this.MusicPlayList()
    } else log("No Audio files Found!")
  }

  async USBSearchDrive () {
    let drives = await Drives.list()
    drives.forEach(async (drive) => {
      if (!drive.isSystem && drive.isUSB && drive.mountpoints[0]){
        log("Found USB Drive:", drive.description , "in", drive.device)
        var drive_path = path.normalize(drive.mountpoints[0].path)
        log("USB Path Drive:", drive_path)
        await this.search(drive_path)
      }
    })
  }

  USBAutoDetect () {
    USB.on('attach', (device) => {
      log("USB Key Detected")
      setTimeout(async () => {
        this.audioList= []
        await this.USBSearchDrive()
        if (this.audioList.length) {
          log("Audio files Found:", this.audioList.length)
          if (this.config.autoStart) this.MusicPlayList()
        }
      }, 5000)
    })

    USB.on('detach', (device) => {
      log("Warn: USB Key Released!")
      this.destroyPlayer()
      this.init()
    })
    console.log("[MUSIC] AutoDetect USB Key Activated")
  }

  search (Path) {
    if (!fs.existsSync(Path)){
      console.log("[MUSIC] Error: No such directory",Path)
      return
    }
    log("Search in", Path)
    var FileList=fs.readdirSync(Path)
    FileList.forEach(file => {
      var filename=path.join(Path,file)
      var stat = fs.lstatSync(filename)
      if (stat.isDirectory()){
        if (this.config.checkSubDirectory) this.search(filename)
      }else {
        var isValidFileExtension = this.checkValidFileExtension(filename)
        if (isValidFileExtension) {
          log("Found:", filename)
          this.audioList.push(filename)
        }
      }
    })
  }
  
  checkValidFileExtension (filename) {
    var found = false
    this.FileExtensions.forEach(extension => {
      if (filename.toLowerCase().endsWith(extension)) found = true
    })
    return found
  }

  async MusicPlayList () {
    await this.destroyPlayer()
    if (!this.audioList.length) {
      this.MusicPlayerStatus.idMax = 0
      return console.log("[GA:Music] No Music to Read")
    } else {
      this.MusicPlayerStatus.idMax = this.audioList.length-1
    }

    if (this.MusicPlayerStatus.id == null) {
      this.MusicPlayerStatus.id = 0
      this.MusicPlayer()
    }
    else {
      this.MusicPlayerStatus.id++
      if (this.MusicPlayerStatus.id > this.audioList.length-1) this.MusicPlayerStatus.id = null
      else this.MusicPlayer() 
    }
  }

  /** Music Player **/
  async MusicPlayer () {
    try {
      const metadata = await mm.parseFile(this.audioList[this.MusicPlayerStatus.id])

      log("Infos from file:", this.audioList[this.MusicPlayerStatus.id])
      log("Title:", metadata.common.title ? metadata.common.title : "unknow" )
      log("Artist:" , metadata.common.artist ? metadata.common.artist: "unknow")
      log("Release Date:", metadata.common.date ? metadata.common.date : "unknow")
      log("Duration:", parseInt((metadata.format.duration).toFixed(0)) + " secs")
      log("Format:", metadata.format.codec)
      log("PlayList Id:", this.MusicPlayerStatus.id, "/" + this.MusicPlayerStatus.idMax)

      // make structure
      this.MusicPlayerStatus.connected= false
      this.MusicPlayerStatus.current= 0
      this.MusicPlayerStatus.duration= parseInt((metadata.format.duration).toFixed(0))
      this.MusicPlayerStatus.file= this.audioList[this.MusicPlayerStatus.id]
      this.MusicPlayerStatus.title= metadata.common.title ? metadata.common.title : path.basename(this.MusicPlayerStatus.file)
      this.MusicPlayerStatus.artist= metadata.common.artist ? metadata.common.artist: "Unknow"
      this.MusicPlayerStatus.date= metadata.common.date ? metadata.common.date : "Unknow"
      this.MusicPlayerStatus.seed = Date.now()
      this.MusicPlayerStatus.format = metadata.format.codec
      this.MusicPlayerStatus.current= null

      const cover = mm.selectCover(metadata.common.picture);
      if (cover) {
        let picture = `data:${cover.format};base64,${cover.data.toString('base64')}`;
        log("Cover Format:", cover.format)
        var filepath = base64Img.imgSync(picture, this.config.modulePath + "/tmp/Music/", 'cover')
        log("Cover Saved to:", filepath)
        this.MusicPlayerStatus.cover = path.basename(filepath)
      }
      else log("No Cover Found")

      var cvlcArgs = ["--no-http-forward-cookies", "--play-and-exit", "--video-title=library @bugsounet/cvlc Music Player"]
      this.Music = new cvlc(cvlcArgs)
      this.Music.play(
        this.MusicPlayerStatus.file,
        ()=> {
          this.MusicPlayerStatus.connected = true
          log("Start playing:", this.MusicPlayerStatus.file)
          this.realTimeInfo()
        },
        ()=> {
          if ((this.MusicPlayerStatus.id > this.MusicPlayerStatus.idMax) || this.MusicPlayerStatus.id == null) {
            this.MusicPlayerStatus.connected = false
            this.send(this.MusicPlayerStatus)
          }
          log("Music is now ended !")
          clearInterval(this.MusicInterval)
          if (this.EndWithNoCb) {
            this.EndWithNoCb = false
            return
          }
          if (this.forceStop) {
            this.forceStop = false
            this.MusicPlayerStatus.connected = false
            this.send(this.MusicPlayerStatus)
            return
          }
          this.MusicPlayList()
          
        }
      )
    } catch (error) {
      console.error("[MUSIC] Music Player Error:", error.message)
      clearInterval(this.MusicInterval)
      if (this.MusicPlayerStatus.id+1 > this.MusicPlayerStatus.idMax) {
        this.MusicPlayerStatus.connected = false
        this.send(this.MusicPlayerStatus)
      }      
      this.MusicPlayList()
    }
  }

  realTimeInfo () {
    this.MusicInterval = setInterval(() => {
      this.Music.cmd("get_time", (err, response) => {
        this.MusicPlayerStatus.current= (parseInt(response)+1)
        this.Music.cmd("volume", (err,res) => {
          this.MusicPlayerStatus.volume= (parseInt(res)*100)/256
        })
        this.send(this.MusicPlayerStatus)
      })
    }, 1000)
  }

  send (data) {
    this.sendSocketNotification("Music_Player", data)
  }
  
  destroyPlayer () {
    if (this.Music) {
      this.Music.destroy()
      this.Music= null
      clearInterval(this.MusicInterval)
      log("Boom! Cvlc Player Destroyed!")
    }
  }
  
  getConnected () {
    return this.MusicPlayerStatus.connected
  }

  setPause () {
    if (this.Music) {
      this.Music.cmd("pause")
      log("Paused")
    }
  }

  setPlay () {
    if (this.Music) {
      this.Music.cmd("play")
      log("Play")
    }
    else this.MusicPlayList()
    
  }

  setStop (EndWithNoCb = false) {
    this.forceStop = true
    if (EndWithNoCb) this.EndWithNoCb = true
    this.destroyPlayer()
  }
  
  setNext () {
    if (this.Music) {
      this.setStop (true)
      this.MusicPlayList()
      log("Next")
    }
  }

  setPrevious () {
    if (this.Music) {
      this.MusicPlayerStatus.id--
      if (this.MusicPlayerStatus.id < 0) this.MusicPlayerStatus.id = 0
      this.setStop (true)
      this.MusicPlayer()
      log("Previous")
    }
  }

  setVolume (volume) { // Warn must be 0-256
    if (this.Music) {
      this.Music.cmd("volume " + volume)
      log("Volume", volume)
    }
  }

  rebuild () {
    this.setStop()
    this.init()
    this.start()
  }
}

module.exports = PLAYER
