// A deterministic demonstration model. No values are measurements or process specifications.
export const METRICS = [
 {key:'temperature',label:'室内温度',unit:'°C',digits:1},
 {key:'humidity',label:'相对湿度',unit:'% RH',digits:1},
 {key:'pressure',label:'室内压差',unit:'Pa',digits:1},
 {key:'power',label:'建筑功率',unit:'MW',digits:2}
];
const industrial=new Set(['FAB1','FAB2','LAB','MASK']);
export class CampusSimulation{
 constructor(){this.reset();}
 reset(){this.elapsed=0;this.paused=false;this.scenario='normal';this.scenarioStart=0;this.events=[];this.active=new Set();this.sequence=0;this.faultAtTransition=0;}
 get fault(){const age=Math.max(0,this.elapsed-this.scenarioStart);if(this.scenario==='cooling-fault')return Math.min(1,this.faultAtTransition+age/16);if(this.scenario==='recovery')return Math.max(0,this.faultAtTransition-age/20);return 0;}
 setScenario(s){if(!['normal','cooling-fault','recovery'].includes(s))return;const fault=this.fault;this.scenario=s;this.scenarioStart=this.elapsed;this.faultAtTransition=fault;}
 advance(dt){if(!this.paused)this.elapsed+=Math.max(0,Math.min(dt,5));}
 sample(buildingId){const seed=[...buildingId].reduce((a,c)=>a+c.charCodeAt(0),0);const phase=seed*.19;const f=this.fault,t=this.elapsed;const fab=industrial.has(buildingId);const values={temperature:(fab?22:24)+.28*Math.sin(t/17+phase)+5.4*f,humidity:45+1.8*Math.sin(t/23+phase)+9*f,pressure:(fab?16:6)+.6*Math.sin(t/11+phase)-(fab?12:5)*f,power:(fab?(buildingId.startsWith('FAB')?12.5:4.2):buildingId==='HQ'?1.8:.6)*(1+.025*Math.sin(t/13+phase)+.16*f)};
 const alarms=[];if(values.temperature>(fab?25:27))alarms.push('temperature');if(values.pressure<(fab?8:2))alarms.push('pressure');if(values.humidity>55)alarms.push('humidity');
 return {buildingId,simulated:true,simulationSeconds:+t.toFixed(2),scenario:this.scenario,values,alarms,thresholds:{temperatureHigh:fab?25:27,pressureLow:fab?8:2,humidityHigh:55}};}
 evaluate(buildingIds){for(const id of buildingIds){const s=this.sample(id);for(const key of ['temperature','pressure','humidity']){const tag=`${id}:${key}`,on=s.alarms.includes(key),was=this.active.has(tag);if(on===was)continue;if(on)this.active.add(tag);else this.active.delete(tag);this.events.unshift({id:++this.sequence,buildingId:id,metric:key,state:on?'active':'resolved',time:+this.elapsed.toFixed(1),value:+s.values[key].toFixed(2),simulated:true});}}this.events=this.events.slice(0,80);}
 snapshot(buildingIds){return {schema:'campus-simulation/1',simulated:true,connection:'none',metricDefinitions:METRICS,exportedAt:new Date().toISOString(),simulationSeconds:this.elapsed,paused:this.paused,scenario:this.scenario,buildings:buildingIds.map(id=>this.sample(id)),events:this.events};}
}
