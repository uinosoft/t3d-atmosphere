// Based on: https://github.com/takram-design-engineering/three-geospatial/blob/main/packages/atmosphere/src/celestialDirections.ts

/**
 * The MIT License (MIT)

 * Copyright (c) 2024 Shota Matsuda

 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.

 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import {
	AstroTime,
	Body,
	CombineRotation,
	GeoVector,
	Rotation_EQJ_EQD,
	RotationMatrix,
	SiderealTime
} from 'astronomy-engine';
import { Matrix4, Vector3 } from 't3d';

const matrixScratch = /* #__PURE__ */ new Matrix4();

function RotationZ(angle) {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return new RotationMatrix([
		[cos, -sin, 0],
		[sin, cos, 0],
		[0, 0, 1]
	]);
}

// Prefer number to be JS timestamp.
function makeTime(value) {
	return value instanceof AstroTime
		? value
		: new AstroTime(value instanceof Date ? value : new Date(value));
}

export function getECIToECEFRotationMatrix(
	date,
	result = new Matrix4()
) {
	const time = makeTime(date);
	const rotationEQJtoEQD = Rotation_EQJ_EQD(time);
	const rotationEQDtoECEF = RotationZ(SiderealTime(time) * (-Math.PI / 12));
	const { rot } = CombineRotation(rotationEQJtoEQD, rotationEQDtoECEF);
	// prettier-ignore
	return result.set(
		rot[0][0], rot[0][1], rot[0][2], 0,
		rot[1][0], rot[1][1], rot[1][2], 0,
		rot[2][0], rot[2][1], rot[2][2], 0,
		0, 0, 0, 1
	);
}

function getDirectionECI(
	body,
	time,
	result
) {
	const { x, y, z } = GeoVector(body, time, false);
	return result.set(x, y, z).normalize();
}

function getDirectionECEF(
	body,
	time,
	result
) {
	const matrix = getECIToECEFRotationMatrix(time, matrixScratch);
	return getDirectionECI(body, time, result).applyMatrix4(matrix);
}

export function getSunDirectionECI(
	date,
	result = new Vector3()
) {
	return getDirectionECI(Body.Sun, makeTime(date), result);
}

export function getMoonDirectionECI(
	date,
	result = new Vector3()
) {
	return getDirectionECI(Body.Moon, makeTime(date), result);
}

export function getSunDirectionECEF(
	date,
	result = new Vector3()
) {
	return getDirectionECEF(Body.Sun, makeTime(date), result);
}

export function getMoonDirectionECEF(
	date,
	result = new Vector3()
) {
	return getDirectionECEF(Body.Moon, makeTime(date), result);
}
