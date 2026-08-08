export type PoolGroup='solids'|'stripes';
export type PoolBall={number:number;x:number;y:number;pocketed:boolean};
export type PoolFrame={balls:Array<{number:number;x:number;y:number;pocketed:boolean}>};
export type PoolShotResult={balls:PoolBall[];frames:PoolFrame[];pocketed:number[];firstContact?:number;cuePocketed:boolean};

export const TABLE={left:54,right:946,top:54,bottom:446,radius:12,pocketRadius:25};
const POCKETS=[[54,54],[500,48],[946,54],[54,446],[500,452],[946,446]] as const;

export function rackPoolBalls():PoolBall[]{
  const balls:PoolBall[]=[{number:0,x:260,y:250,pocketed:false}];
  const order=[1,9,2,10,8,3,11,4,12,5,13,6,14,7,15];
  let index=0;
  for(let row=0;row<5;row++)for(let column=0;column<=row;column++){
    balls.push({number:order[index++],x:650+row*21,y:250-row*12+column*24,pocketed:false});
  }
  return balls;
}

export function poolGroup(number:number):PoolGroup|undefined{return number>=1&&number<=7?'solids':number>=9&&number<=15?'stripes':undefined;}

export function validCuePosition(balls:PoolBall[],x:number,y:number){
  if(x<TABLE.left+TABLE.radius||x>TABLE.right-TABLE.radius||y<TABLE.top+TABLE.radius||y>TABLE.bottom-TABLE.radius)return false;
  return balls.every(ball=>ball.number===0||ball.pocketed||Math.hypot(ball.x-x,ball.y-y)>=TABLE.radius*2.15);
}

export function simulatePoolShot(source:PoolBall[],angle:number,power:number):PoolShotResult{
  const balls=source.map(ball=>({...ball}));
  const cue=balls.find(ball=>ball.number===0);
  if(!cue||cue.pocketed)throw new Error('请先放置母球');
  const strength=Math.max(.08,Math.min(1,power));
  const velocity=new Map<number,{x:number;y:number}>();
  for(const ball of balls)velocity.set(ball.number,{x:0,y:0});
  velocity.set(0,{x:Math.cos(angle)*strength*14,y:Math.sin(angle)*strength*14});
  const pocketed:number[]=[],frames:PoolFrame[]=[];let firstContact:number|undefined;
  for(let step=0;step<1400;step++){
    for(const ball of balls){
      if(ball.pocketed)continue;
      const v=velocity.get(ball.number)!;ball.x+=v.x;ball.y+=v.y;
      for(const[pocketX,pocketY]of POCKETS)if(Math.hypot(ball.x-pocketX,ball.y-pocketY)<=TABLE.pocketRadius){ball.pocketed=true;v.x=0;v.y=0;pocketed.push(ball.number);break;}
      if(ball.pocketed)continue;
      if(ball.x<TABLE.left+TABLE.radius){ball.x=TABLE.left+TABLE.radius;v.x=Math.abs(v.x)*.86;}
      if(ball.x>TABLE.right-TABLE.radius){ball.x=TABLE.right-TABLE.radius;v.x=-Math.abs(v.x)*.86;}
      if(ball.y<TABLE.top+TABLE.radius){ball.y=TABLE.top+TABLE.radius;v.y=Math.abs(v.y)*.86;}
      if(ball.y>TABLE.bottom-TABLE.radius){ball.y=TABLE.bottom-TABLE.radius;v.y=-Math.abs(v.y)*.86;}
    }
    for(let left=0;left<balls.length;left++)for(let right=left+1;right<balls.length;right++){
      const a=balls[left],b=balls[right];if(a.pocketed||b.pocketed)continue;
      const dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy),minimum=TABLE.radius*2;
      if(distance<=0||distance>=minimum)continue;
      const nx=dx/distance,ny=dy/distance,overlap=(minimum-distance)/2;a.x-=nx*overlap;a.y-=ny*overlap;b.x+=nx*overlap;b.y+=ny*overlap;
      const av=velocity.get(a.number)!,bv=velocity.get(b.number)!,relative=(av.x-bv.x)*nx+(av.y-bv.y)*ny;
      if(relative<=0)continue;
      av.x-=relative*nx;av.y-=relative*ny;bv.x+=relative*nx;bv.y+=relative*ny;
      if(firstContact===undefined){if(a.number===0&&b.number!==0)firstContact=b.number;else if(b.number===0&&a.number!==0)firstContact=a.number;}
    }
    let moving=false;
    for(const ball of balls){const v=velocity.get(ball.number)!;v.x*=.985;v.y*=.985;if(Math.abs(v.x)<.018)v.x=0;if(Math.abs(v.y)<.018)v.y=0;if(v.x||v.y)moving=true;}
    if(step%8===0)frames.push({balls:balls.map(ball=>({number:ball.number,x:Number(ball.x.toFixed(2)),y:Number(ball.y.toFixed(2)),pocketed:ball.pocketed}))});
    if(!moving&&step>5)break;
  }
  if(frames.length>120){const stride=Math.ceil(frames.length/120);return{balls,frames:frames.filter((_frame,index)=>index%stride===0||index===frames.length-1),pocketed,firstContact,cuePocketed:pocketed.includes(0)};}
  return{balls,frames,pocketed,firstContact,cuePocketed:pocketed.includes(0)};
}
