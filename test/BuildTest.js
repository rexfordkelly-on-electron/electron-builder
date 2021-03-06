import test from "ava-tf"
import fse from "fs-extra"
import tmp from "tmp"
import Promise from "bluebird"
import assertThat from "should/as-function"
import * as path from "path"
import { parse as parsePlist } from "plist"
import { Packager } from "../out/packager"
import { exec } from "../out/util"
import { readText } from "../out/promisifed-fs"
import { CSC_LINK, CSC_KEY_PASSWORD } from "./helpers/codeSignData"
import pathSorter from "path-sort"

const copyDir = Promise.promisify(fse.copy)
const tmpDir = Promise.promisify(tmp.dir)

const expectedLinuxContents = ['/',
  '/opt/',
  '/usr/',
  '/opt/TestApp/',
  '/opt/TestApp/content_shell.pak',
  '/opt/TestApp/icudtl.dat',
  '/opt/TestApp/libnode.so',
  '/opt/TestApp/LICENSE',
  '/opt/TestApp/LICENSES.chromium.html',
  '/opt/TestApp/natives_blob.bin',
  '/opt/TestApp/pkgtarget',
  '/opt/TestApp/snapshot_blob.bin',
  '/opt/TestApp/TestApp',
  '/opt/TestApp/version',
  '/usr/share/',
  '/opt/TestApp/resources/',
  '/opt/TestApp/resources/app.asar',
  '/opt/TestApp/resources/atom.asar',
  '/usr/share/applications/',
  '/usr/share/applications/TestApp.desktop',
  '/usr/share/doc/',
  '/usr/share/icons/',
  '/usr/share/doc/testapp/',
  '/usr/share/doc/testapp/changelog.Debian.gz',
  '/usr/share/icons/hicolor/',
  '/usr/share/icons/hicolor/128x128/',
  '/usr/share/icons/hicolor/16x16/',
  '/usr/share/icons/hicolor/256x256/',
  '/usr/share/icons/hicolor/32x32/',
  '/usr/share/icons/hicolor/48x48/',
  '/usr/share/icons/hicolor/512x512/',
  '/usr/share/icons/hicolor/128x128/apps/',
  '/usr/share/icons/hicolor/128x128/apps/TestApp.png',
  '/usr/share/icons/hicolor/16x16/apps/',
  '/usr/share/icons/hicolor/16x16/apps/TestApp.png',
  '/usr/share/icons/hicolor/256x256/apps/',
  '/usr/share/icons/hicolor/256x256/apps/TestApp.png',
  '/usr/share/icons/hicolor/32x32/apps/',
  '/usr/share/icons/hicolor/32x32/apps/TestApp.png',
  '/usr/share/icons/hicolor/48x48/apps/',
  '/usr/share/icons/hicolor/48x48/apps/TestApp.png',
  '/usr/share/icons/hicolor/512x512/apps/',
  '/usr/share/icons/hicolor/512x512/apps/TestApp.png'
]

async function assertPack(projectDir, platform, target, useTempDir) {
  projectDir = path.join(__dirname, "fixtures", projectDir)
  // const isDoNotUseTempDir = platform === "darwin"
  if (useTempDir) {
    // non-osx test uses the same dir as osx test, but we cannot share node_modules (because tests executed in parallel)
    const dir = await tmpDir({
      unsafeCleanup: true,
      prefix: platform
    })
    await copyDir(projectDir, dir, {
      filter: function (p) {
        const basename = path.basename(p)
        return basename !== "dist" && basename !== "node_modules" && basename[0] !== "."
      }
    })
    projectDir = dir
  }

  const packager = new Packager({
    projectDir: projectDir,
    cscLink: CSC_LINK,
    cscKeyPassword: CSC_KEY_PASSWORD,
    dist: true,
    platform: [platform],
    target: target
  })

  await packager.build()
  if (platform === "darwin") {
    const packedAppDir = projectDir + "/dist/TestApp-darwin-x64/TestApp.app"
    const info = parsePlist(await readText(packedAppDir + "/Contents/Info.plist"))
    assertThat(info).has.properties({
      CFBundleDisplayName: "TestApp",
      CFBundleIdentifier: "your.id",
      LSApplicationCategoryType: "your.app.category.type",
      CFBundleVersion: "1.0.0" + "." + (process.env.TRAVIS_BUILD_NUMBER || process.env.CIRCLE_BUILD_NUM)
    })

    const result = await exec("codesign", ["--verify", packedAppDir])
    assertThat(result[0].toString()).not.match(/is not signed at all/)
  }
  else if (platform === "linux") {
    assertThat(await getContents(projectDir + "/dist/TestApp-1.0.0-amd64.deb")).deepEqual(expectedLinuxContents)
    assertThat(await getContents(projectDir + "/dist/TestApp-1.0.0-i386.deb")).deepEqual(expectedLinuxContents)
    // console.log(await getContents(projectDir + "/dist/TestApp-1.0.0-amd64.deb"))
    // console.log(await getContents(projectDir + "/dist/TestApp-1.0.0-i386.deb"))
  }
}

async function getContents(path) {
  const result = await exec("dpkg", ["--contents", path])
  return pathSorter(result[0]
    .split("\n")
    .map(it => it.length === 0 ? null : it.substring(it.indexOf('.') + 1))
    .filter(it => it != null && !(it.startsWith("/opt/TestApp/locales/") || it.startsWith("/opt/TestApp/libgcrypt")))
    )
}

if (process.env.TRAVIS !== "true") {
  // we don't use CircleCI, so, we can safely set this env
  process.env.CIRCLE_BUILD_NUM = 42
}

if (process.platform === "darwin") {
  test("mac: two-package.json", async function () {
    await assertPack("test-app", "darwin")
  })

  test("mac: one-package.json", async function () {
    await assertPack("test-app-one", "darwin")
  })
}

if (process.platform !== "win32") {
  test("linux", async function () {
    await assertPack("test-app-one", "linux")
  })

  test("no-author-email", async (t) => {
    t.throws(assertPack("test-app-no-author-email", "linux"), /Please specify author 'email' in .*/)
  })
}

if (!process.env.TRAVIS) {
  test("win", async function () {
    await assertPack("test-app-one", "win32")
  })
  test("win: nsis", async function () {
    await assertPack("test-app-one", "win32", ["nsis"], true)
  })
}