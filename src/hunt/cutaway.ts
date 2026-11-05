import * as THREE from 'three';

/**
 * Third-person "cutaway": trees, branches and bushes that come between the camera and the wizard are dithered away,
 * so the fight always stays visible (the same trick big action games use). Only the materials a stage lists get
 * it; floors never do. Both points are updated every frame by the hunt camera.
 */
export const cut = { cam: { value: new THREE.Vector3() }, target: { value: new THREE.Vector3() } };

const RADIUS = 1.3;

export function addCutaway(mat: THREE.Material) {
  if (mat.userData.cutaway) return;
  mat.userData.cutaway = true;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uCutCam = cut.cam; sh.uniforms.uCutTarget = cut.target;
    sh.vertexShader = 'varying vec3 vCutW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `varying vec3 vCutW;\nuniform vec3 uCutCam, uCutTarget;\n` + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      {
        vec3 seg = uCutTarget - uCutCam; float L2 = max(dot(seg, seg), 1e-4);
        float t = clamp(dot(vCutW - uCutCam, seg) / L2, 0.0, 1.0);
        float d = length(vCutW - (uCutCam + seg * t));
        // Inside the capsule between camera and wizard (not behind the wizard): screen-door dither, softer at the rim.
        float k = (1.0 - smoothstep(${(RADIUS * 0.6).toFixed(2)}, ${RADIUS.toFixed(2)}, d)) * step(t, 0.93);
        float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (k > 0.0 && n < k * 0.85) discard;
      }`);
  };
  mat.needsUpdate = true;
}
