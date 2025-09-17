import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { QRUploadManager } from '../components/qr/QRUploadManager'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog'
import { 
  QrCode, 
  Search, 
  Filter, 
  Download, 
  Upload,
  Building2,
  MapPin,
  FileImage,
  Grid3X3,
  List,
  Plus
} from 'lucide-react'

interface QRCodeItem {
  id: string
  customer: string
  area: string
  subArea: string
  floor: string
  category: string
  qrCodeData: string
  imageUrl?: string
  createdAt: string
}

export default function QRLibraryPage() {
  const navigate = useNavigate()
  const [userType, setUserType] = useState<string>('')
  const [userId, setUserId] = useState<string>('')
  const [userName, setUserName] = useState<string>('')
  const [qrCodes, setQrCodes] = useState<QRCodeItem[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState('all')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [loading, setLoading] = useState(true)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)

  useEffect(() => {
    // Get user info from localStorage
    const type = localStorage.getItem('userType')
    const id = localStorage.getItem('userId')
    const name = localStorage.getItem('userName')

    if (!type || !id || !name || type !== 'admin') {
      navigate('/login')
      return
    }

    setUserType(type)
    setUserId(id)
    setUserName(name)
    loadQRCodes()
  }, [navigate])

  const loadQRCodes = async () => {
    // For now, we'll use mock data until you upload the zip files
    const mockQRCodes: QRCodeItem[] = [
      {
        id: '1',
        customer: 'Sunward Park',
        area: 'Reception',
        subArea: 'Main Desk',
        floor: 'Ground Floor',
        category: 'Office Areas',
        qrCodeData: 'SP_RECEPTION_001',
        createdAt: '2024-01-01'
      },
      {
        id: '2',
        customer: 'Sunward Park',
        area: 'Toilet',
        subArea: 'Male Toilet',
        floor: 'Ground Floor',
        category: 'Ablutions',
        qrCodeData: 'SP_TOILET_M_001',
        createdAt: '2024-01-01'
      },
      {
        id: '3',
        customer: 'Box Office',
        area: 'Reception',
        subArea: 'Customer Service',
        floor: 'Ground Floor',
        category: 'Office Areas',
        qrCodeData: 'BO_RECEPTION_001',
        createdAt: '2024-01-01'
      },
      {
        id: '4',
        customer: 'Box Office',
        area: 'Kitchen',
        subArea: 'Staff Kitchen',
        floor: 'First Floor',
        category: 'Kitchen Areas',
        qrCodeData: 'BO_KITCHEN_001',
        createdAt: '2024-01-01'
      }
    ]
    
    setQrCodes(mockQRCodes)
    setLoading(false)
  }

  if (!userType || !userId || !userName) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  const customers = [...new Set(qrCodes.map(qr => qr.customer))]
  const categories = [...new Set(qrCodes.map(qr => qr.category))]

  const filteredQRCodes = qrCodes.filter(qr => {
    const matchesSearch = qr.area.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         qr.subArea.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         qr.customer.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCustomer = selectedCustomer === 'all' || qr.customer === selectedCustomer
    const matchesCategory = selectedCategory === 'all' || qr.category === selectedCategory
    
    return matchesSearch && matchesCustomer && matchesCategory
  })

  const generateQRCodeImage = (data: string) => {
    // This would typically generate a QR code image
    // For now, we'll return a placeholder
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`
  }

  const handleUploadComplete = (uploadedFiles: any[]) => {
    console.log('Upload completed:', uploadedFiles)
    // Here you would typically save the new QR codes to your database
    // and refresh the QR codes list
    setUploadDialogOpen(false)
    loadQRCodes() // Refresh the list
  }

  return (
    <Sidebar07Layout userType={userType as 'cleaner' | 'manager' | 'admin'} userName={userName}>
      <div className="space-y-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              QR Code Library
            </h1>
            <p className="text-gray-600 text-lg">Manage and organize all customer area QR codes</p>
          </div>
          <div className="flex gap-3">
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Upload className="h-4 w-4" />
                  Upload QR Codes
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Upload Customer QR Code Collections
                  </DialogTitle>
                </DialogHeader>
                <QRUploadManager onUploadComplete={handleUploadComplete} />
              </DialogContent>
            </Dialog>
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Export All
            </Button>
          </div>
        </div>

        {/* Filters and Search */}
        <Card className="card-modern border-0 shadow-xl">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-600 mb-2 block">Search QR Codes</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by area, customer, or location..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              
              <div className="flex gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-600 mb-2 block">Customer</label>
                  <select
                    value={selectedCustomer}
                    onChange={(e) => setSelectedCustomer(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All Customers</option>
                    {customers.map(customer => (
                      <option key={customer} value={customer}>{customer}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-gray-600 mb-2 block">Category</label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All Categories</option>
                    {categories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-600 mb-2 block">View</label>
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                    <Button
                      variant={viewMode === 'grid' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('grid')}
                      className="rounded-none"
                    >
                      <Grid3X3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'list' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('list')}
                      className="rounded-none"
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600 mb-1">{qrCodes.length}</div>
              <div className="text-sm text-gray-600">Total QR Codes</div>
            </CardContent>
          </Card>
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600 mb-1">{customers.length}</div>
              <div className="text-sm text-gray-600">Customers</div>
            </CardContent>
          </Card>
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-indigo-600 mb-1">{categories.length}</div>
              <div className="text-sm text-gray-600">Categories</div>
            </CardContent>
          </Card>
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-600 mb-1">{filteredQRCodes.length}</div>
              <div className="text-sm text-gray-600">Filtered Results</div>
            </CardContent>
          </Card>
        </div>

        {/* QR Codes Display */}
        <Tabs defaultValue="library" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="library">QR Library</TabsTrigger>
            <TabsTrigger value="categories">By Categories</TabsTrigger>
          </TabsList>
          
          <TabsContent value="library">
            <Card className="card-modern border-0 shadow-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <QrCode className="h-6 w-6 text-blue-600" />
                  QR Code Collection
                </CardTitle>
              </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
              </div>
            ) : filteredQRCodes.length === 0 ? (
              <div className="text-center py-12">
                <QrCode className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg">No QR codes found</p>
                <p className="text-gray-400">Try adjusting your search filters</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredQRCodes.map((qr) => (
                  <Card key={qr.id} className="card-modern border-0 shadow-lg hover:shadow-xl transition-shadow">
                    <CardContent className="p-4">
                      <div className="text-center space-y-3">
                        <img
                          src={generateQRCodeImage(qr.qrCodeData)}
                          alt={`QR Code for ${qr.area}`}
                          className="w-32 h-32 mx-auto border rounded-lg"
                        />
                        <div>
                          <h3 className="font-semibold text-gray-900">{qr.area}</h3>
                          <p className="text-sm text-gray-600">{qr.subArea}</p>
                        </div>
                        <div className="space-y-1">
                          <Badge className="bg-blue-100 text-blue-700">{qr.customer}</Badge>
                          <div className="text-xs text-gray-500">
                            <div className="flex items-center gap-1 justify-center">
                              <Building2 className="h-3 w-3" />
                              {qr.floor}
                            </div>
                            <div className="flex items-center gap-1 justify-center">
                              <MapPin className="h-3 w-3" />
                              {qr.category}
                            </div>
                          </div>
                        </div>
                        <Button size="sm" className="w-full gap-2">
                          <Download className="h-3 w-3" />
                          Download
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredQRCodes.map((qr) => (
                  <div key={qr.id} className="flex items-center gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                    <img
                      src={generateQRCodeImage(qr.qrCodeData)}
                      alt={`QR Code for ${qr.area}`}
                      className="w-16 h-16 border rounded"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{qr.area}</h3>
                        <Badge className="bg-blue-100 text-blue-700">{qr.customer}</Badge>
                      </div>
                      <p className="text-sm text-gray-600">{qr.subArea} • {qr.floor} • {qr.category}</p>
                      <p className="text-xs text-gray-400 font-mono">{qr.qrCodeData}</p>
                    </div>
                    <Button size="sm" variant="outline" className="gap-2">
                      <Download className="h-3 w-3" />
                      Download
                    </Button>
                  </div>
                ))}
              </div>
            )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="categories">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {categories.map((category) => {
                const categoryQRs = filteredQRCodes.filter(qr => qr.category === category)
                const customerGroups = [...new Set(categoryQRs.map(qr => qr.customer))]
                
                return (
                  <Card key={category} className="card-modern border-0 shadow-lg">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-blue-600" />
                        {category}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="text-sm text-gray-600">
                          {categoryQRs.length} QR codes across {customerGroups.length} customers
                        </div>
                        {customerGroups.map((customer) => {
                          const customerQRsInCategory = categoryQRs.filter(qr => qr.customer === customer)
                          return (
                            <div key={customer} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                              <span className="font-medium text-gray-900">{customer}</span>
                              <Badge variant="secondary">{customerQRsInCategory.length}</Badge>
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Sidebar07Layout>
  )
}
