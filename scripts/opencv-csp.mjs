// The pinned Emscripten runtime contains two optimized dynamic invokers.
// Replace them with the corresponding closure-based calling conventions.
// Reference: Emscripten libembind.js and libemval.js, DYNAMIC_EXECUTION == 0.
// https://github.com/emscripten-core/emscripten/blob/main/src/lib/libembind.js
// https://github.com/emscripten-core/emscripten/blob/main/src/lib/libemval.js
const SAFE_EMBIND = `function createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync){
  var needsDestructorStack=usesDestructorStack(argTypes);
  var argCount=argTypes.length-2;
  return function(humanName,throwBindingError,invoker,fn,runDestructors,fromRetWire,toClassParamWire,...converters){
    return function(...args){
      var destructors=needsDestructorStack?[]:null;
      var wired=[fn];
      if(isClassMethodFunc) wired.push(toClassParamWire(destructors,this));
      for(var i=0;i<argCount;i++) wired.push(converters[i](destructors,args[i]));
      var rv=invoker(...wired);
      if(needsDestructorStack) runDestructors(destructors);
      else {
        var dtorIndex=argCount;
        for(var i=isClassMethodFunc?1:2;i<argTypes.length;i++){
          if(argTypes[i].destructorFunction!==null) converters[dtorIndex++](wired[isClassMethodFunc?i:i-1]);
        }
      }
      if(returns) return fromRetWire(rv);
    };
  };
}`;

const SAFE_EMVAL = `var __emval_create_invoker=(argCount,argTypesPtr,kind)=>{
  var GenericWireTypeSize=8;
  var [retType,...argTypes]=emval_lookupTypes(argCount,argTypesPtr);
  var toReturnWire=retType.toWireType.bind(retType);
  var argFromPtr=argTypes.map(type=>type.readValueFromPointer.bind(type));
  var invokerFunction=(handle,methodName,destructorsRef,args)=>{
    var argN=argFromPtr.map((read,index)=>read(args+index*GenericWireTypeSize));
    var rv;
    switch(kind){
      case 0: rv=Reflect.apply(Emval.toValue(handle),undefined,argN); break;
      case 1: {
        var receiver=Emval.toValue(handle);
        rv=receiver[getStringOrSymbol(methodName)](...argN);
        break;
      }
      case 2: rv=Reflect.construct(Emval.toValue(handle),argN); break;
      case 3: rv=argN[0]; break;
      default: throw new TypeError('Unknown Emscripten invocation kind');
    }
    if(!retType.isVoid) return emval_returnValue(toReturnWire,destructorsRef,rv);
  };
  var functionName='methodCaller<('+argTypes.map(t=>t.name)+') => '+retType.name+'>';
  return emval_addMethodCaller(createNamedFunction(functionName,invokerFunction));
};`;

function replaceSection(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || source.indexOf(startMarker, start + startMarker.length) !== -1) throw new Error('Pinned OpenCV binding layout changed; review the CSP patch.');
  return source.slice(0, start) + replacement + source.slice(end);
}

export function patchOpenCV(source) {
  let patched = replaceSection(source, 'function createJsInvoker(', 'function craftInvokerFunction(', SAFE_EMBIND);
  patched = replaceSection(patched, 'var __emval_create_invoker=', 'var __emval_get_property=', SAFE_EMVAL);
  if (/\bnew\s+Function\s*\(|\beval\s*\(/.test(patched)) throw new Error('OpenCV still contains dynamic JavaScript execution.');
  return patched;
}
