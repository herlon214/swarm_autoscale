const { Docker } = require('node-docker-api')
const docker = new Docker({ socketPath: '/var/run/docker.sock' })
const debug = require('debug')('autoscale')

const timeout = ms => new Promise(res => setTimeout(res, ms))

const scale = async (service, replicas) => {
  debug(`Scaling service ${service.data.Spec.Name} to ${replicas}`)
  const data = service.data.Spec
  data.version = service.data.Version.Index
  data.Mode.Replicated.Replicas = replicas

  return service.update(data)
}

const getContainers = async (service) => {
  const img = service.data.Spec.TaskTemplate.ContainerSpec.Image
  const containers = await docker.container.list()

  return containers.filter((container) => container.data.Image === img)
}

const serviceBalance = async (service) => {
  debug(`Balancing service ${service.data.Spec.Name}...`)

  let containers = await getContainers(service)
  containers = containers.filter((container) => container.data.State === 'running')
  let runningCount = containers.length
  let newRunningCount = runningCount

  if (runningCount > 0) {
    // Scale up the service
    await scale(service, service.data.Spec.Mode.Replicated.Replicas + 1)

    // Wait for the new container be running
    while (newRunningCount === runningCount) {
      debug(`Waiting for the new container of ${service.data.Spec.Name}...`)
      let newContainers = await getContainers(service)
      newRunningCount = newContainers.filter((container) => container.data.State === 'running').length
      await timeout(5000)
    }

    // Remove the oldest container
    await containers[containers.length - 1].kill()

    service = await service.status()

    // Scale down the service
    await scale(service, service.data.Spec.Mode.Replicated.Replicas - 1)
  } else {
    debug(`No containers running with service ${service.data.Spec.Name}`)
  }
}

async function init () {
  const [services] = await Promise.all([ docker.service.list() ])

  const serviceList = services.reduce((list, service) => {
    list[service.data.Spec.Name] = service
    return list
  }, {})

  try {
    const name = process.argv.slice(2)[0]
    const service = serviceList[name]
    await serviceBalance(service)
  } catch (err) {
    console.log(err)
  }
}

init()