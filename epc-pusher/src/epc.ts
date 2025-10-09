
import { ethers } from 'ethers'
import { Address, EVM, createWebEVM } from 'webevm'
import epcAbi from '../lib/abi/EPCPure.json'


class LocalContract {
  iface: ethers.Interface
  address: Address
  evm: EVM

  constructor(contract: { bytecode: string, abi: any }) {
    this.evm = createWebEVM()
    let contractCode = Buffer.from(
      ethers.getBytes(contract.bytecode).buffer
    )
    let r = this.evm.runCall({
      data: contractCode,
      gasLimit: BigInt(2 ** 32),
    })

    if (r.execResult.exceptionError) {
      throw `EVM Error: ${JSON.stringify(r.execResult.exceptionError)}`
    }

    this.address = r.createdAddress as any
    this.iface = new ethers.Interface(contract.abi)

    return new Proxy<any>(
      this,
      {
        get(target, prop, receiver) {
          if (typeof(prop) === "symbol" || prop in target) {
            return Reflect.get(target, prop, receiver)
          }
          let f = target.iface.getFunction(prop as string)
          if (f) {
            return (...args: any) => target._call(f, args)
          }
        },
      },
    )
  }

  _call(func: ethers.FunctionFragment, args: any[]): any {

    let data: Buffer
    try {
      let encoded = this.iface.encodeFunctionData(func, args)
      data = Buffer.from(ethers.getBytes(encoded))
    } catch (e) {
      console.log(`error encoding ${func.name}`)
      throw e
    }
    
    let r = this.evm.runPure({ to: this.address, data })

    if (r.execResult.exceptionError) {
      console.log("evm error calling", func.name, args)
      if (r.execResult.returnValue.length) {
        try {
          let err = this.iface.parseError(r.execResult.returnValue)
          console.log("evm error", err)
        } catch (e) {
          console.log("Couldnt decode error", ethers.hexlify(r.execResult.returnValue))
        }
      } else {
        console.log("evm no error data")
      }
      throw r
    }

    let result = this.iface.decodeFunctionResult(
      func,
      r.execResult.returnValue,
    )

    return result
  }
}

const epcPure = new LocalContract(epcAbi) as any

export function getEpcAddress(key: string) {
  return epcPure.epcAddressWithDeployer(key, process.env.EPC_CONTRACT_ADDRESS)[0]
}



/*
 * Get an EPC address with minimal dependencies.
 * 
 * Just uses ethers v6 (for example ^6.15.0).
 */
function getEpcAddressAlgo(key: string, deployer: string) {

  /*
   * Fixed proxy initcode hash as in Solady
   * https://github.com/Vectorized/solady/blob/main/src/utils/CREATE3.sol
   */

  const PROXY_INITCODE_HASH = "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f"

  /*
   * Create the salt hash
   */

  let prefix = "ETHEREUM PLACE CODE"
  let saltInput = Array.prototype.concat(
    new Array(...ethers.toUtf8Bytes(prefix)),
    new Array(32-prefix.length).fill(0),
    new Array(...ethers.toUtf8Bytes(key))
  )
  let salt = ethers.keccak256(new Uint8Array(saltInput))

  /*
   * First deployment; CREATE2 with salt hash deployer and fixed initcode to get the proxy
   */

  let b = Array.prototype.concat(
    [0xff],
    new Array(...ethers.getBytes(deployer)),
    new Array(...ethers.getBytes(salt)),
    new Array(...ethers.getBytes(PROXY_INITCODE_HASH))
  )

  let proxy = ethers.keccak256(new Uint8Array(b))

  /*
   * Second deployment; CREATE with wallet nonce = 1
   */
  b = Array.prototype.concat(
    [0xd6, 0x94],
    new Array(...ethers.getBytes(proxy).slice(12)),
    [0x01]
  )
  let r = ethers.keccak256(new Uint8Array(b))

  /*
   * Normalize and return
   */
  return ethers.getAddress(`0x${r.slice(26)}`)
}





function testGenEpcAddress() {
  function t(key: string) {
    let a = getEpcAddress(key)
    let b = getEpcAddressAlgo(key, process.env.EPC_CONTRACT_ADDRESS as string)
    if (a != b) {
      throw `generate EPC address failed, expecting ${a} but got ${b}`
    }
  }
  t("")
  t("fooo")
  t("0xd9f1b81fe7c738f8d9dac0a20bc12f4335983f1503f86fae7aa601637615fa4e0xd9f1b81fe7c738f8d9dac0a20bc12f4335983f1503f86fae7aa601637615fa4e")
  console.log("ok")
}

