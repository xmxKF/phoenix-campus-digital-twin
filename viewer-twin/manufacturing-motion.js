// Interpolate recorded simulation poses, retaining rail corners and hoist stops.
export function sampleMotion(samples,time){
 if(!samples?.length)return null;
 if(time<=samples[0].time)return samples[0];
 if(time>=samples.at(-1).time)return samples.at(-1);
 let i=1;while(samples[i].time<time)i++;
 const a=samples[i-1],b=samples[i],k=(time-a.time)/(b.time-a.time);
 const pose={position:a.position.map((v,j)=>v+(b.position[j]-v)*k)};
 if(a.heading!==undefined&&b.heading!==undefined)pose.heading=a.heading+Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading))*k;
 return pose;
}
