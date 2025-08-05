import { MathUtils, Vector3 } from 't3d';

const vectorScratch1 = /* #__PURE__ */ new Vector3();
const vectorScratch2 = /* #__PURE__ */ new Vector3();
const vectorScratch3 = /* #__PURE__ */ new Vector3();

function getImageData(texture) {
	if (texture.image.data) {
		return texture.image.data;
	}

	if (texture.userData.imageData) {
		return texture.userData.imageData;
	}

	return undefined;
}

function samplePixel(data, index, result) {
	const dataIndex = index * 4; // Assume RGBA
	return result.fromArray(data, dataIndex, true);
}

export function sampleTexture(texture, uv, result) {
	const data = getImageData(texture);
	if (data == null) {
		return result.setScalar(0);
	}

	const { width, height } = texture.image;
	const x = MathUtils.clamp(uv.x, 0, 1) * (width - 1);
	const y = MathUtils.clamp(uv.y, 0, 1) * (height - 1);
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const tx = x - xi;
	const ty = y - yi;
	const sx = tx;
	const sy = ty;
	const rx0 = xi % width;
	const rx1 = (rx0 + 1) % width;
	const ry0 = yi % height;
	const ry1 = (ry0 + 1) % height;
	const v00 = samplePixel(data, ry0 * width + rx0, vectorScratch1);
	const v10 = samplePixel(data, ry0 * width + rx1, vectorScratch2);
	const nx0 = v00.lerp(v10, sx);
	const v01 = samplePixel(data, ry1 * width + rx0, vectorScratch2);
	const v11 = samplePixel(data, ry1 * width + rx1, vectorScratch3);
	const nx1 = v01.lerp(v11, sx);
	return result.copy(nx0.lerp(nx1, sy));
}