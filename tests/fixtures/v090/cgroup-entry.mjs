import {enterWorkerCgroup} from '../../../dist/installation/worker-cgroup.js';

// Actual exec preserves the kernel group and PID, while replacing Node's memory
// image with the selected interpreter. This fixture is not a product launcher.
if(process.argv.length<5||!process.execve)throw Error('Linux Node execve fixture required');
const identity=JSON.parse(process.argv[2]),executable=process.argv[3],args=process.argv.slice(4);
enterWorkerCgroup(identity);
process.execve(executable,[executable,...args],{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',TZ:'UTC'});
