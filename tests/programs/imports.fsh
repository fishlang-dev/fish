// mode: parse
import React, { useState, type FC } from "react"
import * as path from "node:path"
import type { Config } from "./config.ts"
import "./polyfills.ts"
import json from "./data.json" with { type: "json" }
import fs = require("fs")
import Shapes = Geometry.Shapes
const lazy = await import("./lazy.ts")
const here = import.meta.url
